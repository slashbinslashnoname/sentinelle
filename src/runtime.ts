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

/**
 * Upper bound on how many addresses a single index operation will query against
 * the explorer, so a misconfigured ceiling can't trigger millions of requests.
 */
const MAX_INDEX_SCAN = 2000;

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

  /**
   * Resolve (creating if needed) the account row for the configured xpub, or
   * null when no valid xpub is set. Centralises the ensure() call so the status
   * view and the index tools agree on which account they operate on.
   */
  private currentAccount(): { id: number; deriver: AddressDeriver } | null {
    if (!this.deriver) return null;
    const id = this.accounts.ensure(
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
    return { id, deriver: this.deriver };
  }

  /** Ask the explorer whether an address has ever appeared on-chain. */
  private async addressUsage(
    address: string,
  ): Promise<{ everUsed: boolean; receivedSat: bigint }> {
    const url = `${this.explorerUrl().replace(/\/$/, "")}/api/address/${address}`;
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`explorer HTTP ${res.status}`);
    const d = (await res.json()) as {
      chain_stats: { funded_txo_sum: number; tx_count: number };
      mempool_stats: { funded_txo_sum: number; tx_count: number };
    };
    const txCount = d.chain_stats.tx_count + d.mempool_stats.tx_count;
    const receivedSat =
      BigInt(d.chain_stats.funded_txo_sum) + BigInt(d.mempool_stats.funded_txo_sum);
    return { everUsed: txCount > 0, receivedSat };
  }

  /**
   * Force the next derivation index for the configured account. Raising it is
   * always safe (it just skips ahead). Lowering it re-exposes the range
   * `[index, current)`, so we refuse if any of those indexes is locked by a
   * pending invoice or has ever touched the chain — "skip-back protection".
   */
  async setNextIndex(
    index: number,
  ): Promise<{ ok: boolean; nextIndex?: number; error?: string }> {
    const acct = this.currentAccount();
    if (!acct) return { ok: false, error: "No xpub configured" };
    if (!Number.isInteger(index) || index < 0) {
      return { ok: false, error: "Index must be a non-negative integer" };
    }
    if (index > acct.deriver.maxIndex) {
      return { ok: false, error: `Index exceeds the ceiling ${acct.deriver.maxIndex}` };
    }

    const current = this.accounts.peekNextIndex(acct.id);
    if (index < current) {
      const span = current - index;
      if (span > MAX_INDEX_SCAN) {
        return {
          ok: false,
          error: `Refusing to verify ${span} addresses at once; lower in smaller steps or recycle empty addresses instead.`,
        };
      }
      const pending = new Set(this.invoices.pendingOnchainIndexes(acct.id));
      const chain = this.settings.chain();
      for (let i = index; i < current; i++) {
        if (pending.has(i)) {
          return { ok: false, error: `Index ${i} is in use by a pending invoice.` };
        }
        const { address } = acct.deriver.derive(i, chain);
        try {
          const usage = await this.addressUsage(address);
          if (usage.everUsed) {
            return {
              ok: false,
              error: `Index ${i} (${address}) already has on-chain history; refusing to reuse it.`,
            };
          }
        } catch (err) {
          return {
            ok: false,
            error: `Could not verify index ${i}: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }
    }

    this.accounts.setNextIndex(acct.id, index);
    return { ok: true, nextIndex: index };
  }

  /**
   * Find the next index that is safe to issue: walking forward from the current
   * counter, return the first index whose address has no on-chain history,
   * skipping any that are already used (e.g. a reused wallet) or locked by a
   * pending invoice. Read-only — it suggests a value for {@link setNextIndex} to
   * save, it does not move the counter itself.
   */
  async findNextEmptyIndex(): Promise<{
    ok: boolean;
    index?: number;
    scanned?: number;
    error?: string;
  }> {
    const acct = this.currentAccount();
    if (!acct) return { ok: false, error: "No xpub configured" };

    const start = this.accounts.peekNextIndex(acct.id);
    const pending = new Set(this.invoices.pendingOnchainIndexes(acct.id));
    const chain = this.settings.chain();

    for (let scanned = 0; scanned < MAX_INDEX_SCAN; scanned++) {
      const i = start + scanned;
      if (i > acct.deriver.maxIndex) {
        return {
          ok: false,
          error: `Reached the ceiling ${acct.deriver.maxIndex} without finding an empty address.`,
        };
      }
      if (pending.has(i)) continue;
      const { address } = acct.deriver.derive(i, chain);
      try {
        const usage = await this.addressUsage(address);
        if (!usage.everUsed) return { ok: true, index: i, scanned: scanned + 1 };
      } catch (err) {
        return {
          ok: false,
          error: `Scan stopped at index ${i}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
    return {
      ok: false,
      error: `No empty address found in the next ${MAX_INDEX_SCAN} indexes.`,
    };
  }

  status(): {
    onchain: RailStatus;
    lightning: RailStatus;
    nextIndex: number | null;
    recycled: number | null;
  } {
    let nextIndex: number | null = null;
    let recycled: number | null = null;
    const acct = this.currentAccount();
    if (acct) {
      nextIndex = this.accounts.peekNextIndex(acct.id);
      recycled = this.accounts.recycledCount(acct.id);
    }

    const onchain: RailStatus = this.deriver
      ? {
          enabled: true,
          ok: true,
          detail: `${this.deriver.scriptType} on ${this.deriver.network}, next index ${nextIndex}`,
        }
      : {
          enabled: false,
          ok: !this.deriverError,
          detail: this.deriverError ?? "No xpub configured",
        };

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
