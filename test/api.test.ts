import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { openDatabase } from "../src/db/database.js";
import {
  AccountRepository,
  InvoiceRepository,
  RefundRepository,
  SettingsRepository,
} from "../src/db/repositories.js";
import {
  AdminAuthRepository,
  ApiKeyRepository,
} from "../src/db/authRepositories.js";
import { AppSettings, SETTING_KEYS } from "../src/settings.js";
import { EventBus } from "../src/events.js";
import { Runtime } from "../src/runtime.js";
import { startServer, type ServerHandle } from "../src/http/server.js";
import type { RouteDeps } from "../src/http/routes.js";

const ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";

let handle: ServerHandle;
let base: string;
let adminCookie = "";
let apiKey = "";

beforeAll(async () => {
  const db = openDatabase(":memory:");
  const invoices = new InvoiceRepository(db);
  const accounts = new AccountRepository(db);
  const settingsRepo = new SettingsRepository(db);
  // Configure on-chain + a fixed rate so no network is needed.
  settingsRepo.set(SETTING_KEYS.xpub, ZPUB, 1);
  settingsRepo.set(SETTING_KEYS.rateProvider, "fixed", 1);
  settingsRepo.set(SETTING_KEYS.fixedRateEur, "50000", 1);
  const settings = new AppSettings(settingsRepo);
  const admin = new AdminAuthRepository(db);
  const apiKeys = new ApiKeyRepository(db);
  const refunds = new RefundRepository(db);
  const events = new EventBus();
  const runtime = new Runtime(settings, invoices, accounts, refunds, events);

  const deps: RouteDeps = { runtime, settings, invoices, admin, apiKeys, now: Date.now };
  handle = startServer(deps, events, { port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => {
    if (handle.server.listening) return resolve();
    handle.server.once("listening", () => resolve());
  });
  const addr = handle.server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await handle.close();
});

describe("admin auth flow", () => {
  it("starts unregistered", async () => {
    const r = await fetch(`${base}/api/admin/state`);
    expect(await r.json()).toMatchObject({ registered: false, authenticated: false });
  });

  it("registers and sets a session cookie", async () => {
    const r = await fetch(`${base}/api/admin/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "supersecret" }),
    });
    expect(r.status).toBe(201);
    const setCookie = r.headers.get("set-cookie") ?? "";
    adminCookie = setCookie.split(";")[0]!;
    expect(adminCookie.startsWith("sid=")).toBe(true);
  });

  it("rejects admin endpoints without a session", async () => {
    const r = await fetch(`${base}/api/admin/status`);
    expect(r.status).toBe(401);
  });

  it("creates an API key", async () => {
    const r = await fetch(`${base}/api/admin/keys`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ label: "test-shop" }),
    });
    expect(r.status).toBe(201);
    const body = (await r.json()) as { key: string };
    expect(body.key.startsWith("snl_")).toBe(true);
    apiKey = body.key;
  });
});

describe("merchant invoice flow", () => {
  it("rejects creation without an API key", async () => {
    const r = await fetch(`${base}/api/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: "10", currency: "EUR" }),
    });
    expect(r.status).toBe(401);
  });

  it("creates a EUR invoice with an on-chain address and matching amount", async () => {
    const r = await fetch(`${base}/api/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ amount: "10.00", currency: "EUR", externalId: "order-1" }),
    });
    expect(r.status).toBe(201);
    const inv = (await r.json()) as {
      id: string;
      amountSat: string;
      onchain: { address: string };
      bip21: string;
      exchangeRate: { currency: string; pricePerBtc: string; source: string } | null;
      paymentPolicy: { timeoutSeconds: number; confirmations: number; zeroconfMaxSat: string };
    };
    expect(inv.amountSat).toBe("20000"); // 10 EUR @ 50k => 20000 sat
    expect(inv.onchain.address).toBe("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
    expect(inv.bip21).toContain("bitcoin:");
    // The fiat↔BTC rate is returned and locked at creation.
    expect(inv.exchangeRate).toMatchObject({ currency: "EUR", pricePerBtc: "50000.00", source: "fixed" });
    // The admin's timeout/confirmation settings are echoed (not taken from the request).
    expect(inv.paymentPolicy).toMatchObject({ timeoutSeconds: 900, confirmations: 0 });
    expect(typeof inv.paymentPolicy.zeroconfMaxSat).toBe("string");
  });

  it("exposes a public view without merchant secrets", async () => {
    const create = await fetch(`${base}/api/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ amount: "0.001", currency: "BTC", metadata: { secret: "x" } }),
    });
    const inv = (await create.json()) as { id: string };
    const pub = await fetch(`${base}/api/public/invoices/${inv.id}`);
    const body = (await pub.json()) as Record<string, unknown>;
    expect(body.amountBtc).toBe("0.00100000");
    expect(body.exchangeRate).toBeNull(); // BTC-priced -> no conversion
    expect(body).not.toHaveProperty("metadata");
    expect(body).not.toHaveProperty("callbackUrl");
  });
});

describe("websocket events + webhook settlement", () => {
  it("streams invoice.paid to an invoice-scoped socket when a webhook settles it", async () => {
    const create = await fetch(`${base}/api/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ amount: "0.0001", currency: "BTC" }),
    });
    const inv = (await create.json()) as { id: string };

    const wsUrl = base.replace("http", "ws") + `/ws?invoice=${inv.id}`;
    const ws = new WebSocket(wsUrl);
    const paid = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no paid event")), 5000);
      ws.on("message", (data) => {
        const ev = JSON.parse(data.toString());
        if (ev.type === "invoice.paid") {
          clearTimeout(timer);
          resolve(ev);
        }
      });
      ws.on("error", reject);
    });
    await new Promise<void>((r) => ws.on("open", () => r()));

    // Simulate phoenixd webhook (no secret configured -> accepted).
    const hook = await fetch(`${base}/webhooks/phoenixd`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "payment_received",
        externalId: inv.id,
        paymentHash: "abc",
        amountSat: 10000,
      }),
    });
    expect(hook.status).toBe(200);

    const ev = (await paid) as { invoiceId: string; status: string };
    expect(ev.invoiceId).toBe(inv.id);
    expect(ev.status).toBe("paid");
    ws.close();

    // And the public view now reports paid.
    const pub = await fetch(`${base}/api/public/invoices/${inv.id}`);
    expect((await pub.json() as { status: string }).status).toBe("paid");
  });

  it("replays the paid state to a socket that connects AFTER settlement", async () => {
    const create = await fetch(`${base}/api/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ amount: "0.0001", currency: "BTC" }),
    });
    const inv = (await create.json()) as { id: string };

    // Settle it before any socket exists.
    await fetch(`${base}/webhooks/phoenixd`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ externalId: inv.id, paymentHash: "late", amountSat: 10000 }),
    });

    // Connect now — the catch-up should immediately deliver invoice.paid.
    const ws = new WebSocket(base.replace("http", "ws") + `/ws?invoice=${inv.id}`);
    const paid = new Promise<{ invoiceId: string; detail?: { replay?: boolean } }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no catch-up paid event")), 5000);
      ws.on("message", (data) => {
        const ev = JSON.parse(data.toString());
        if (ev.type === "invoice.paid") {
          clearTimeout(timer);
          resolve(ev);
        }
      });
      ws.on("error", reject);
    });

    const ev = await paid;
    expect(ev.invoiceId).toBe(inv.id);
    expect(ev.detail?.replay).toBe(true);
    ws.close();
  });
});

// Runs last: it locks 127.0.0.1 out of admin login for the lockout window.
describe("admin login rate limiting", () => {
  const login = (password: string) =>
    fetch(`${base}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });

  it("locks login after 3 wrong attempts, refusing even the correct password", async () => {
    expect((await login("wrongpassword")).status).toBe(401);
    expect((await login("wrongpassword")).status).toBe(401);
    expect((await login("wrongpassword")).status).toBe(429); // 3rd failure locks
    const stillLocked = await login("wrongpassword");
    expect(stillLocked.status).toBe(429);
    expect(stillLocked.headers.get("retry-after")).toBeTruthy();
    // The right password is rejected while the lockout is in effect.
    expect((await login("supersecret")).status).toBe(429);
  });
});
