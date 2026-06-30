/**
 * HTTP routes (Hono). Three trust zones, kept deliberately small:
 *
 *   public   — read-only, addressed by the invoice's unguessable UUID only
 *   merchant — create/read/cancel invoices, gated by an API key
 *   admin    — settings, keys & operations, gated by a login session
 *
 * Every handler validates its input, returns JSON, and never echoes a secret.
 */

import type { Hono } from "hono";
import { cors } from "hono/cors";
import { setCookie, deleteCookie } from "hono/cookie";
import { serveStatic } from "@hono/node-server/serve-static";
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import type { Runtime } from "../runtime.js";
import type { AppSettings } from "../settings.js";
import type { InvoiceRepository } from "../db/repositories.js";
import type {
  AdminAuthRepository,
  ApiKeyRepository,
} from "../db/authRepositories.js";
import { requireAdmin, requireMerchant, adminSessionToken } from "./auth.js";
import { fullView, publicView, refundView } from "./views.js";
import { invoicesToCsv, invoicesToXlsx } from "./accounting.js";
import { adminPage } from "./adminPage.js";
import { InvoiceServiceError } from "../core/invoiceService.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const CreateInvoiceSchema = z.object({
  amount: z.string().min(1).max(32),
  currency: z.enum(["BTC", "EUR", "USD"]),
  description: z.string().max(128).optional(),
  externalId: z.string().max(128).optional(),
  metadata: z.record(z.unknown()).optional(),
  callbackUrl: z.string().url().max(2048).optional(),
});
const SettingsSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
const XpubSchema = z.object({ xpub: z.string().min(8).max(256) });
const RefundSchema = z.object({
  amountSat: z.union([z.string(), z.number()]),
  reference: z.string().max(256).optional(),
  note: z.string().max(512).optional(),
});
const PasswordSchema = z.object({ password: z.string().min(8).max(256) });
const KeySchema = z.object({ label: z.string().max(64).optional() });

export interface RouteDeps {
  runtime: Runtime;
  settings: AppSettings;
  invoices: InvoiceRepository;
  admin: AdminAuthRepository;
  apiKeys: ApiKeyRepository;
  now: () => number;
  /** Absolute path of the built React admin SPA, if present. */
  adminUiDir?: string;
  /** serveStatic root (relative to cwd) for the admin SPA assets. */
  adminUiRoot?: string;
}

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

export function registerRoutes(app: Hono, deps: RouteDeps): void {
  const now = deps.now;

  app.use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    await next();
  });

  // CORS from the admin-configured allowlist, evaluated live per request.
  app.use(
    "*",
    cors({
      origin: (origin) => deps.settings.resolveCorsOrigin(origin) ?? "",
      credentials: true,
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Api-Key"],
    }),
  );

  const adminGuard = requireAdmin(deps.admin, now);
  const merchantGuard = requireMerchant(deps.apiKeys, now);

  // ----------------------------------------------------- phoenixd webhook ---
  // Needs the raw body for the HMAC check.
  app.post("/webhooks/phoenixd", async (c) => {
    const raw = await c.req.text();
    const secret = deps.settings.phoenixdWebhookSecret();
    if (secret) {
      const provided = c.req.header("X-Phoenix-Signature") ?? "";
      const expected = createHmac("sha256", secret).update(raw).digest("hex");
      const a = Buffer.from(provided, "utf8");
      const b = Buffer.from(expected, "utf8");
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return c.json({ error: "invalid signature" }, 401);
      }
    }
    let payload: { externalId?: string; paymentHash?: string; amountSat?: number };
    try {
      payload = JSON.parse(raw);
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    if (!payload.externalId) return c.json({ ignored: "no externalId" }, 202);
    const amountSat = BigInt(Math.max(0, Math.floor(payload.amountSat ?? 0)));
    deps.runtime
      .getService()
      .settle(payload.externalId, "lightning", amountSat, payload.paymentHash ?? "lightning");
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- public ---
  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/api/public/invoices/:id", (c) => {
    const inv = deps.runtime.getService().get(c.req.param("id"));
    if (!inv) return c.json({ error: "not found" }, 404);
    return c.json(publicView(inv));
  });

  // -------------------------------------------------------------- merchant ---
  app.post("/api/invoices", merchantGuard, async (c) => {
    const parsed = CreateInvoiceSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      return c.json({ error: "invalid request", details: parsed.error.issues }, 400);
    }
    try {
      const inv = await deps.runtime.getService().create(parsed.data);
      return c.json(fullView(inv), 201);
    } catch (err) {
      if (err instanceof InvoiceServiceError) {
        return c.json({ error: err.message, code: err.code }, err.code === "rail_unavailable" ? 503 : 400);
      }
      throw err;
    }
  });

  app.get("/api/invoices/:id", merchantGuard, (c) => {
    const inv = deps.runtime.getService().get(c.req.param("id"));
    if (!inv) return c.json({ error: "not found" }, 404);
    return c.json(fullView(inv));
  });

  app.post("/api/invoices/:id/cancel", merchantGuard, (c) => {
    const inv = deps.runtime.getService().cancel(c.req.param("id"));
    if (!inv) return c.json({ error: "invoice not cancelable (already settled or gone)" }, 409);
    return c.json(fullView(inv));
  });

  // ------------------------------------------------------- admin auth flow ---
  app.get("/api/admin/state", (c) => {
    const token = adminSessionToken(c);
    return c.json({
      registered: deps.admin.isRegistered(),
      authenticated: Boolean(token && deps.admin.isValidSession(token, now())),
    });
  });

  app.post("/api/admin/register", async (c) => {
    if (deps.admin.isRegistered()) {
      return c.json({ error: "admin already registered; use login" }, 409);
    }
    const parsed = PasswordSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      return c.json({ error: "password must be at least 8 characters" }, 400);
    }
    deps.admin.setPassword(parsed.data.password, now());
    issueSession(deps, c);
    return c.json({ ok: true }, 201);
  });

  app.post("/api/admin/login", async (c) => {
    const parsed = PasswordSchema.safeParse(await readJson(c));
    if (!parsed.success || !deps.admin.verifyPassword(parsed.data.password)) {
      return c.json({ error: "invalid password" }, 401);
    }
    issueSession(deps, c);
    return c.json({ ok: true });
  });

  app.post("/api/admin/logout", (c) => {
    const token = adminSessionToken(c);
    if (token) deps.admin.deleteSession(token);
    deleteCookie(c, "sid", { path: "/" });
    return c.json({ ok: true });
  });

  // ------------------------------------------------------ admin protected ---
  app.get("/api/admin/status", adminGuard, (c) => c.json(deps.runtime.status()));
  app.get("/api/admin/stats", adminGuard, (c) => c.json(deps.invoices.counts()));

  app.get("/api/admin/invoices", adminGuard, (c) => {
    const status = c.req.query("status");
    const allowed = ["pending", "paid", "expired", "canceled"];
    const list = deps.invoices.list({
      status: status && allowed.includes(status) ? (status as never) : undefined,
      limit: Number(c.req.query("limit") ?? 50),
      offset: Number(c.req.query("offset") ?? 0),
    });
    return c.json(list.map(fullView));
  });

  // Accounting export. Conversion is locked at order time, so this is the
  // compliant record of each sale: ?from=&to= accept epoch ms or ISO dates.
  // CSV opens in Excel, Numbers and Google Sheets; XLSX is native Excel/Numbers.
  const exportRows = (c: { req: { query: (k: string) => string | undefined } }) => {
    const parseTs = (v: string | undefined, def: number): number => {
      if (!v) return def;
      const n = Number(v);
      if (Number.isFinite(n)) return n;
      const d = Date.parse(v);
      return Number.isNaN(d) ? def : d;
    };
    const status = c.req.query("status");
    const allowed = ["pending", "paid", "expired", "canceled"];
    return deps.invoices.listForExport({
      from: parseTs(c.req.query("from"), 0),
      to: parseTs(c.req.query("to"), now()),
      status: status && allowed.includes(status) ? (status as never) : undefined,
    });
  };

  app.get("/api/admin/export.csv", adminGuard, (c) => {
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="sentinelle-export.csv"`);
    return c.body(invoicesToCsv(exportRows(c)));
  });

  app.get("/api/admin/export.xlsx", adminGuard, async (c) => {
    const buf = await invoicesToXlsx(exportRows(c));
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="sentinelle-export.xlsx"`,
      },
    });
  });

  // Reimbursements: record a refund against a paid invoice (supports partials).
  app.post("/api/admin/invoices/:id/refunds", adminGuard, async (c) => {
    const parsed = RefundSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: "provide { amountSat, reference?, note? }" }, 400);
    let amountSat: bigint;
    try {
      amountSat = BigInt(Math.trunc(Number(parsed.data.amountSat)));
    } catch {
      return c.json({ error: "amountSat must be an integer number of sats" }, 400);
    }
    try {
      const result = deps.runtime.getService().refund(c.req.param("id"), {
        amountSat,
        reference: parsed.data.reference,
        note: parsed.data.note,
      });
      if (!result) return c.json({ error: "invoice not found" }, 404);
      return c.json({ invoice: fullView(result.invoice), refund: refundView(result.refund) }, 201);
    } catch (err) {
      if (err instanceof InvoiceServiceError) {
        return c.json({ error: err.message }, err.code === "rail_unavailable" ? 503 : 400);
      }
      throw err;
    }
  });

  app.get("/api/admin/invoices/:id/refunds", adminGuard, (c) => {
    const inv = deps.runtime.getService().get(c.req.param("id"));
    if (!inv) return c.json({ error: "not found" }, 404);
    return c.json(deps.runtime.getService().listRefunds(c.req.param("id")).map(refundView));
  });

  app.get("/api/admin/settings", adminGuard, (c) => c.json(deps.settings.toPublicView()));

  app.put("/api/admin/settings", adminGuard, async (c) => {
    const parsed = SettingsSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: "invalid settings body" }, 400);
    const asStrings: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.data)) asStrings[k] = String(v);
    try {
      const changed = deps.settings.applyUpdates(asStrings);
      deps.runtime.reconfigure();
      return c.json({ changed, settings: deps.settings.toPublicView() });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.get("/api/admin/rates", adminGuard, async (c) => c.json(await deps.runtime.currentRates()));

  app.post("/api/admin/test/phoenixd", adminGuard, async (c) => c.json(await deps.runtime.testPhoenixd()));
  app.post("/api/admin/test/explorer", adminGuard, async (c) => c.json(await deps.runtime.testExplorer()));
  app.post("/api/admin/test/email", adminGuard, async (c) => c.json(await deps.runtime.testEmail()));

  app.post("/api/admin/validate-xpub", adminGuard, async (c) => {
    const parsed = XpubSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: "provide { xpub }" }, 400);
    try {
      return c.json({ ok: true, ...deps.runtime.validateXpub(parsed.data.xpub) });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.get("/api/admin/keys", adminGuard, (c) => c.json(deps.apiKeys.list()));

  app.post("/api/admin/keys", adminGuard, async (c) => {
    const parsed = KeySchema.safeParse((await readJson(c)) ?? {});
    const label = parsed.success ? parsed.data.label ?? "unnamed" : "unnamed";
    const { plaintext, info } = deps.apiKeys.create(label, now());
    return c.json({ key: plaintext, info }, 201);
  });

  app.delete("/api/admin/keys/:id", adminGuard, (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || !deps.apiKeys.revoke(id, now())) {
      return c.json({ error: "key not found or already revoked" }, 404);
    }
    return c.json({ ok: true });
  });

  // --------------------------------------------------------------- admin UI ---
  // Serve the built React SPA when present, with an SPA fallback to index.html;
  // otherwise the zero-build fallback page.
  if (deps.adminUiDir && deps.adminUiRoot && existsSync(deps.adminUiDir)) {
    const root = deps.adminUiRoot;
    app.use(
      "/admin/*",
      serveStatic({
        root,
        // URL is /admin/assets/x.js but the file lives at <root>/assets/x.js.
        rewriteRequestPath: (p) => p.replace(/^\/admin/, ""),
      }),
    );
    const indexHtml = join(deps.adminUiDir, "index.html");
    const html = existsSync(indexHtml) ? readFileSync(indexHtml, "utf8") : adminPage();
    app.get("/admin", (c) => c.html(html));
    app.get("/admin/*", (c) => c.html(html));
  } else {
    app.get("/admin", (c) => c.html(adminPage()));
    app.get("/admin/*", (c) => c.html(adminPage()));
  }
}

function issueSession(deps: RouteDeps, c: Parameters<typeof setCookie>[0]): void {
  const token = deps.admin.createSession(deps.now(), SESSION_TTL_MS);
  setCookie(c, "sid", token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}
