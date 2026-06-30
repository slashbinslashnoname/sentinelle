/**
 * Operational settings, stored in the database and managed at runtime through
 * the admin API. This is the single source of truth for everything except the
 * bootstrap secrets in {@link Config}.
 *
 * Reads fall back to the built-in {@link DEFAULTS} when no value has been saved,
 * so a fresh install is usable immediately and the operator configures the rest
 * (xpub, phoenixd, SMTP, ...) from the admin API — never from `.env`.
 */

import type { SettingsRepository } from "./db/repositories.js";
import { MAX_BIP32_INDEX } from "./bitcoin/derivation.js";

export const SETTING_KEYS = {
  ttlSeconds: "invoice_ttl_seconds",
  xpub: "bitcoin_xpub",
  chain: "bitcoin_chain",
  ceiling: "address_index_ceiling",
  phoenixdUrl: "phoenixd_url",
  phoenixdPassword: "phoenixd_password",
  phoenixdWebhookSecret: "phoenixd_webhook_secret",
  explorerUrl: "explorer_url",
  rateProvider: "rate_provider",
  rateBaseUrl: "rate_base_url",
  fixedRateEur: "fixed_rate_eur",
  fixedRateUsd: "fixed_rate_usd",
  corsOrigins: "cors_origins",
  smtpHost: "smtp_host",
  smtpPort: "smtp_port",
  smtpSecure: "smtp_secure",
  smtpUser: "smtp_user",
  smtpPass: "smtp_pass",
  emailFrom: "email_from",
  emailTo: "email_to",
  notifyEvents: "notify_events",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/** Built-in defaults used when no DB value has been saved yet. */
export const DEFAULTS = {
  ttlSeconds: 900, // 15 minutes
  chain: 0, // external/receive
  ceiling: MAX_BIP32_INDEX,
  explorerUrl: "https://mempool.space",
  rateProvider: "mempool" as "mempool" | "fixed",
  rateBaseUrl: "https://mempool.space",
  fixedRateEur: "60000",
  fixedRateUsd: "65000",
  smtpPort: 587,
  notifyEvents: "invoice.paid",
} as const;

/** Keys that hold secrets and must never be echoed back in plaintext. */
const SECRET_KEYS = new Set<string>([
  SETTING_KEYS.phoenixdPassword,
  SETTING_KEYS.phoenixdWebhookSecret,
  SETTING_KEYS.smtpPass,
]);

export class AppSettings {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly now: () => number = Date.now,
  ) {}

  private str(key: SettingKey, fallback = ""): string {
    const v = this.repo.get(key);
    return v === null ? fallback : v;
  }

  ttlSeconds(): number {
    const v = this.repo.getNumber(SETTING_KEYS.ttlSeconds, DEFAULTS.ttlSeconds);
    return v > 0 ? Math.floor(v) : DEFAULTS.ttlSeconds;
  }

  xpub(): string {
    return this.str(SETTING_KEYS.xpub).trim();
  }

  chain(): number {
    return this.repo.getNumber(SETTING_KEYS.chain, DEFAULTS.chain);
  }

  ceiling(): number {
    const v = this.repo.getNumber(SETTING_KEYS.ceiling, DEFAULTS.ceiling);
    return Math.min(Math.max(0, Math.floor(v)), MAX_BIP32_INDEX);
  }

  phoenixdUrl(): string {
    return this.str(SETTING_KEYS.phoenixdUrl).trim();
  }
  phoenixdPassword(): string {
    return this.str(SETTING_KEYS.phoenixdPassword);
  }
  phoenixdWebhookSecret(): string {
    return this.str(SETTING_KEYS.phoenixdWebhookSecret);
  }

  explorerUrl(): string {
    return this.str(SETTING_KEYS.explorerUrl, DEFAULTS.explorerUrl).trim();
  }

  rateProvider(): "mempool" | "fixed" {
    const v = this.str(SETTING_KEYS.rateProvider, DEFAULTS.rateProvider);
    return v === "fixed" ? "fixed" : "mempool";
  }
  rateBaseUrl(): string {
    return this.str(SETTING_KEYS.rateBaseUrl, DEFAULTS.rateBaseUrl).trim();
  }
  fixedRates(): { EUR: string; USD: string } {
    return {
      EUR: this.str(SETTING_KEYS.fixedRateEur, DEFAULTS.fixedRateEur),
      USD: this.str(SETTING_KEYS.fixedRateUsd, DEFAULTS.fixedRateUsd),
    };
  }

  /** Parsed CORS allowlist. `["*"]` means any origin. Empty means no CORS. */
  corsOrigins(): string[] {
    return this.str(SETTING_KEYS.corsOrigins)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  /** Decide the value to reflect in Access-Control-Allow-Origin, if any. */
  resolveCorsOrigin(requestOrigin: string | undefined): string | null {
    const allow = this.corsOrigins();
    if (allow.length === 0) return null;
    if (allow.includes("*")) return "*";
    if (requestOrigin && allow.includes(requestOrigin)) return requestOrigin;
    return null;
  }

  // --- email notifications ---
  smtpHost(): string {
    return this.str(SETTING_KEYS.smtpHost).trim();
  }
  smtpPort(): number {
    return this.repo.getNumber(SETTING_KEYS.smtpPort, DEFAULTS.smtpPort);
  }
  smtpSecure(): boolean {
    return this.str(SETTING_KEYS.smtpSecure) === "true";
  }
  smtpUser(): string {
    return this.str(SETTING_KEYS.smtpUser);
  }
  smtpPass(): string {
    return this.str(SETTING_KEYS.smtpPass);
  }
  emailFrom(): string {
    return this.str(SETTING_KEYS.emailFrom).trim();
  }
  emailTo(): string {
    return this.str(SETTING_KEYS.emailTo).trim();
  }
  /** Event types that trigger an email. */
  notifyEvents(): string[] {
    return this.str(SETTING_KEYS.notifyEvents, DEFAULTS.notifyEvents)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  emailEnabled(): boolean {
    return this.smtpHost().length > 0 && this.emailTo().length > 0;
  }

  lightningEnabled(): boolean {
    return this.phoenixdUrl().length > 0;
  }
  onchainEnabled(): boolean {
    return this.xpub().length > 0;
  }

  set(key: SettingKey, value: string): void {
    this.repo.set(key, value, this.now());
  }

  /**
   * Apply a batch of updates. Unknown keys are rejected. Returns the keys that
   * were actually changed.
   */
  applyUpdates(updates: Record<string, string>): SettingKey[] {
    const valid = new Set<string>(Object.values(SETTING_KEYS));
    const changed: SettingKey[] = [];
    for (const [k, v] of Object.entries(updates)) {
      if (!valid.has(k)) {
        throw new Error(`Unknown setting "${k}"`);
      }
      this.set(k as SettingKey, String(v));
      changed.push(k as SettingKey);
    }
    return changed;
  }

  /** Admin-facing view: secrets are masked to a boolean "is set". */
  toPublicView(): Record<string, unknown> {
    return {
      [SETTING_KEYS.ttlSeconds]: this.ttlSeconds(),
      [SETTING_KEYS.xpub]: this.xpub(),
      [SETTING_KEYS.chain]: this.chain(),
      [SETTING_KEYS.ceiling]: this.ceiling(),
      [SETTING_KEYS.phoenixdUrl]: this.phoenixdUrl(),
      [SETTING_KEYS.phoenixdPassword]: mask(this.phoenixdPassword()),
      [SETTING_KEYS.phoenixdWebhookSecret]: mask(this.phoenixdWebhookSecret()),
      [SETTING_KEYS.explorerUrl]: this.explorerUrl(),
      [SETTING_KEYS.rateProvider]: this.rateProvider(),
      [SETTING_KEYS.rateBaseUrl]: this.rateBaseUrl(),
      [SETTING_KEYS.fixedRateEur]: this.fixedRates().EUR,
      [SETTING_KEYS.fixedRateUsd]: this.fixedRates().USD,
      [SETTING_KEYS.corsOrigins]: this.corsOrigins().join(","),
      [SETTING_KEYS.smtpHost]: this.smtpHost(),
      [SETTING_KEYS.smtpPort]: this.smtpPort(),
      [SETTING_KEYS.smtpSecure]: this.smtpSecure(),
      [SETTING_KEYS.smtpUser]: this.smtpUser(),
      [SETTING_KEYS.smtpPass]: mask(this.smtpPass()),
      [SETTING_KEYS.emailFrom]: this.emailFrom(),
      [SETTING_KEYS.emailTo]: this.emailTo(),
      [SETTING_KEYS.notifyEvents]: this.notifyEvents().join(","),
      _secretKeys: [...SECRET_KEYS],
    };
  }
}

function mask(value: string): boolean {
  return value.length > 0;
}
