/**
 * Sentinelle entrypoint: load config, open the database, build the runtime,
 * start the HTTP/WebSocket server and the settlement watchers.
 */

import { join } from "node:path";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/database.js";
import {
  AccountRepository,
  InvoiceRepository,
  RefundRepository,
  SettingsRepository,
} from "./db/repositories.js";
import {
  AdminAuthRepository,
  ApiKeyRepository,
} from "./db/authRepositories.js";
import { AppSettings } from "./settings.js";
import { EventBus } from "./events.js";
import { Runtime } from "./runtime.js";
import type { RouteDeps } from "./http/routes.js";
import { startServer } from "./http/server.js";
import { LightningWatcher } from "./watchers/lightning.js";
import { OnchainWatcher } from "./watchers/onchain.js";
import { EmailNotifier } from "./notifications/emailNotifier.js";

function log(msg: string): void {
  console.log(`[sentinelle] ${msg}`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.DATABASE_PATH);

  const invoices = new InvoiceRepository(db);
  const accounts = new AccountRepository(db);
  const refunds = new RefundRepository(db);
  const settingsRepo = new SettingsRepository(db);
  const adminRepo = new AdminAuthRepository(db);
  const apiKeys = new ApiKeyRepository(db);
  const settings = new AppSettings(settingsRepo);
  const events = new EventBus();

  const runtime = new Runtime(settings, invoices, accounts, refunds, events);

  // Built React admin SPA lives at <repo>/admin-ui/dist when built.
  const adminUiRoot = join("admin-ui", "dist");
  const adminUiDir = join(process.cwd(), adminUiRoot);

  const routeDeps: RouteDeps = {
    runtime,
    settings,
    invoices,
    admin: adminRepo,
    apiKeys,
    now: Date.now,
    adminUiDir,
    adminUiRoot,
  };

  const handle = startServer(routeDeps, events, {
    port: config.PORT,
    host: config.HOST,
  });

  const lightning = new LightningWatcher(
    invoices,
    () => runtime.getService(),
    () => runtime.getPhoenixd(),
    10_000,
    log,
  );
  const onchain = new OnchainWatcher(
    invoices,
    () => runtime.getService(),
    runtime.explorerUrl(),
    fetch,
    15_000,
    log,
  );
  lightning.start();
  onchain.start();

  const emailNotifier = new EmailNotifier(
    events,
    settings,
    () => runtime.getMailer(),
    log,
  );
  emailNotifier.start();

  const expiryTimer = setInterval(() => {
    try {
      const n = runtime.getService().expireOverdue();
      if (n > 0) log(`expired ${n} overdue invoice(s)`);
      adminRepo.purgeExpiredSessions(Date.now());
    } catch (err) {
      log(`expiry sweep error: ${String(err)}`);
    }
  }, 30_000);
  expiryTimer.unref?.();

  const status = runtime.status();
  log(`listening on http://${config.HOST}:${config.PORT}`);
  log(`admin UI at http://${config.HOST}:${config.PORT}/admin`);
  log(`on-chain: ${status.onchain.enabled ? status.onchain.detail : "disabled"}`);
  log(`lightning: ${status.lightning.enabled ? status.lightning.detail : "disabled"}`);
  if (!adminRepo.isRegistered()) {
    log("no admin registered yet — open /admin to set the admin password");
  }

  const shutdown = async (sig: string): Promise<void> => {
    log(`received ${sig}, shutting down`);
    lightning.stop();
    onchain.stop();
    emailNotifier.stop();
    clearInterval(expiryTimer);
    await handle.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[sentinelle] fatal:", err);
  process.exit(1);
});
