/**
 * HTTP + WebSocket server (Hono + @hono/node-server + @hono/node-ws).
 *
 * The WebSocket at `/ws` streams invoice lifecycle events:
 *   - `/ws?invoice=<id>`     scoped to a single invoice (public; the id is the
 *                            unguessable capability)
 *   - `/ws?key=<apiKey>`     all events (requires a valid merchant API key)
 *
 * Clients receive each {@link InvoiceEvent} as a JSON text frame.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type { WSContext } from "hono/ws";
import type { Server } from "node:http";
import type { EventBus, InvoiceEvent } from "../events.js";
import { registerRoutes, type RouteDeps } from "./routes.js";
import { adminSessionToken } from "./auth.js";

export interface ServerHandle {
  server: Server;
  close: () => Promise<void>;
}

interface Subscriber {
  invoiceId?: string;
  all: boolean;
}

export function startServer(
  deps: RouteDeps,
  events: EventBus,
  opts: { port: number; host: string },
): ServerHandle {
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  const subscribers = new Map<WSContext, Subscriber>();

  // WebSocket route — must be registered before the catch-all admin routes.
  app.get(
    "/ws",
    upgradeWebSocket((c) => {
      const invoiceId = c.req.query("invoice");
      const key = c.req.query("key");
      const origin = c.req.header("origin");
      // A logged-in admin (same-origin session cookie) may stream all events —
      // this is what the admin dashboard uses to refresh live.
      const adminToken = adminSessionToken(c);
      const isAdmin = adminToken ? deps.admin.isValidSession(adminToken, deps.now()) : false;
      return {
        onOpen(_evt, ws) {
          // Enforce the CORS allowlist for cross-origin browser clients; the
          // same-origin admin session bypasses it.
          if (!isAdmin && origin && deps.settings.resolveCorsOrigin(origin) === null) {
            ws.close(1008, "origin not allowed");
            return;
          }
          const all = isAdmin || (key ? deps.apiKeys.verify(key, deps.now()) : false);
          if (!invoiceId && !all) {
            ws.close(1008, "scope to ?invoice=<id> or present a valid ?key=");
            return;
          }
          subscribers.set(ws, { invoiceId: invoiceId ?? undefined, all });
          ws.send(JSON.stringify({ type: "connected", at: deps.now() }));

          // Catch-up: a client that subscribes to a specific invoice AFTER the
          // payment already happened would otherwise wait forever. Replay the
          // invoice's current state as events, derived from persisted data so it
          // survives restarts (the in-memory bus has no history).
          if (invoiceId) {
            const inv = deps.runtime.getService().get(invoiceId);
            if (inv) {
              const frame = (type: InvoiceEvent["type"], at: number) =>
                JSON.stringify({
                  type,
                  invoiceId: inv.id,
                  at,
                  status: inv.status,
                  amountSat: inv.amountSat.toString(),
                  externalId: inv.externalId,
                  detail: { replay: true },
                } satisfies InvoiceEvent);
              if (inv.detectedAt) ws.send(frame("invoice.payment_detected", inv.detectedAt));
              if (inv.status === "paid") ws.send(frame("invoice.paid", inv.paidAt ?? deps.now()));
              else if (inv.status === "expired") ws.send(frame("invoice.expired", inv.expiresAt));
              else if (inv.status === "canceled") ws.send(frame("invoice.canceled", inv.createdAt));
            }
          }
        },
        onClose(_evt, ws) {
          subscribers.delete(ws);
        },
        onError(_evt, ws) {
          subscribers.delete(ws);
        },
      };
    }),
  );

  registerRoutes(app, deps);

  const unsubscribe = events.subscribe((event: InvoiceEvent) => {
    const frame = JSON.stringify(event);
    for (const [ws, f] of subscribers) {
      if (ws.readyState !== 1) continue;
      if (f.all || f.invoiceId === event.invoiceId) {
        try {
          ws.send(frame);
        } catch {
          subscribers.delete(ws);
        }
      }
    }
  });

  const server = serve({
    fetch: app.fetch,
    port: opts.port,
    hostname: opts.host,
  }) as Server;
  injectWebSocket(server);

  return {
    server,
    close: () =>
      new Promise<void>((resolve) => {
        unsubscribe();
        for (const ws of subscribers.keys()) {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        }
        subscribers.clear();
        server.close(() => resolve());
      }),
  };
}
