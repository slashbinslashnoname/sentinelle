/**
 * The runtime owns the live, settings-derived components: the address deriver,
 * the phoenixd client, the rate provider and the invoice service. When an admin
 * changes settings, {@link Runtime.reconfigure} rebuilds them in place, so the
 * HTTP handlers and watchers (which read through getters) immediately use the
 * new configuration without a restart.
 */

import type { AppSettings } from "./settings.js";
import type { EventBus } from "./events.js";
import {
  AccountRepository,
  InvoiceRepository,
  RefundRepository,
} from "./db/repositories.js";
import { AddressDeriver } from "./bitcoin/derivation.js";
import { HttpPhoenixdClient, type PhoenixdClient } from "./phoenixd/client.js";
import { MempoolRateProvider } from "./rates/mempool.js";
import { FixedRateProvider } from "./rates/fixed.js";
import type { RateProvider } from "./rates/provider.js";
import { InvoiceService } from "./core/invoiceService.js";
import { SmtpMailer, type Mailer } from "./notifications/mailer.js";

export interface RailStatus {
  enabled: boolean;
  ok: boolean;
  detail: string;
}

export class Runtime {
  private deriver: AddressDeriver | null = null;
  private deriverError: string | null = null;
  private phoenixd: PhoenixdClient | null = null;
  private rates!: RateProvider;
  private service!: InvoiceService;
  private mailer: Mailer | null = null;

  constructor(
    private readonly settings: AppSettings,
    private readonly invoices: InvoiceRepository,
    private readonly accounts: AccountRepository,
    private readonly refunds: RefundRepository,
    private readonly events: EventBus,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.build();
  }

  private build(): void {
    // --- on-chain deriver ---
    this.deriver = null;
    this.deriverError = null;
    const xpub = this.settings.xpub();
    if (xpub) {
      try {
        this.deriver = new AddressDeriver(xpub, this.settings.ceiling());
      } catch (err) {
        this.deriverError = err instanceof Error ? err.message : String(err);
      }
    }

    // --- phoenixd client ---
    const url = this.settings.phoenixdUrl();
    this.phoenixd = url
      ? new HttpPhoenixdClient(url, this.settings.phoenixdPassword(), this.fetchImpl)
      : null;

    // --- rate provider ---
    this.rates =
      this.settings.rateProvider() === "fixed"
        ? new FixedRateProvider(this.settings.fixedRates())
        : new MempoolRateProvider(this.settings.rateBaseUrl(), 60_000, this.fetchImpl);

    // --- email notifications ---
    this.mailer = this.settings.smtpHost()
      ? new SmtpMailer({
          host: this.settings.smtpHost(),
          port: this.settings.smtpPort(),
          secure: this.settings.smtpSecure(),
          user: this.settings.smtpUser(),
          pass: this.settings.smtpPass(),
        })
      : null;

    // --- invoice service ---
    this.service = new InvoiceService({
      invoices: this.invoices,
      accounts: this.accounts,
      refunds: this.refunds,
      rates: this.rates,
      deriver: this.deriver ?? undefined,
      phoenixd: this.phoenixd ?? undefined,
      ttlSeconds: () => this.settings.ttlSeconds(),
      chain: this.settings.chain(),
      events: this.events,
    });
  }

  /** Rebuild all components from the current settings. */
  reconfigure(): void {
    this.build();
  }

  getService(): InvoiceService {
    return this.service;
  }

  getPhoenixd(): PhoenixdClient | null {
    return this.phoenixd;
  }

  getMailer(): Mailer | null {
    return this.mailer;
  }

  /** Verify the SMTP connection (admin "test" button). */
  async testEmail(): Promise<{ ok: boolean; detail: string }> {
    if (!this.mailer) {
      return { ok: false, detail: "Email disabled (no SMTP host set)" };
    }
    try {
      await this.mailer.verify();
      return { ok: true, detail: `SMTP ready at ${this.settings.smtpHost()}` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  explorerUrl(): string {
    return this.settings.explorerUrl();
  }

  /** Validate an xpub/ypub/zpub without persisting it; returns a preview. */
  validateXpub(xpub: string): {
    scriptType: string;
    network: string;
    fingerprint: string;
    firstAddress: string;
  } {
    const d = new AddressDeriver(xpub, this.settings.ceiling());
    const first = d.derive(0, this.settings.chain());
    return {
      scriptType: d.scriptType,
      network: d.network,
      fingerprint: d.fingerprint,
      firstAddress: first.address,
    };
  }

  /** Ping the configured phoenixd node. */
  async testPhoenixd(): Promise<{ ok: boolean; detail: string }> {
    if (!this.phoenixd) {
      return { ok: false, detail: "Lightning disabled (no phoenixd URL set)" };
    }
    try {
      const info = await this.phoenixd.getInfo();
      return { ok: true, detail: `Connected to node ${info.nodeId}` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Fetch the current BTC price in EUR and USD from the live provider. */
  async currentRates(): Promise<{
    source: string;
    eur: string | null;
    usd: string | null;
    error?: string;
  }> {
    const fmt = (minor: bigint) => (Number(minor) / 100).toFixed(2);
    try {
      const [eur, usd] = await Promise.all([
        this.rates.btcPriceMinor("EUR"),
        this.rates.btcPriceMinor("USD"),
      ]);
      return { source: this.rates.source, eur: fmt(eur), usd: fmt(usd) };
    } catch (err) {
      return {
        source: this.rates.source,
        eur: null,
        usd: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Check the block explorer is reachable. */
  async testExplorer(): Promise<{ ok: boolean; detail: string }> {
    const url = `${this.explorerUrl().replace(/\/$/, "")}/api/blocks/tip/height`;
    try {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      const height = await res.text();
      return { ok: true, detail: `Explorer tip height ${height.trim()}` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  status(): {
    onchain: RailStatus;
    lightning: RailStatus;
    nextIndex: number | null;
    recycled: number | null;
  } {
    const onchain: RailStatus = this.deriver
      ? {
          enabled: true,
          ok: true,
          detail: `${this.deriver.scriptType} on ${this.deriver.network}, ceiling ${this.deriver.maxIndex}`,
        }
      : {
          enabled: false,
          ok: !this.deriverError,
          detail: this.deriverError ?? "No xpub configured",
        };

    let nextIndex: number | null = null;
    let recycled: number | null = null;
    if (this.deriver) {
      const accountId = this.accounts.ensure(
        {
          fingerprint: this.deriver.fingerprint,
          xpub: "",
          scriptType: this.deriver.scriptType,
          network: this.deriver.network,
          chain: this.settings.chain(),
          ceiling: this.deriver.maxIndex,
        },
        Date.now(),
      );
      nextIndex = this.accounts.peekNextIndex(accountId);
      recycled = this.accounts.recycledCount(accountId);
    }

    return {
      onchain,
      lightning: {
        enabled: Boolean(this.phoenixd),
        ok: Boolean(this.phoenixd),
        detail: this.phoenixd
          ? `phoenixd at ${this.settings.phoenixdUrl()}`
          : "No phoenixd URL configured",
      },
      nextIndex,
      recycled,
    };
  }
}
