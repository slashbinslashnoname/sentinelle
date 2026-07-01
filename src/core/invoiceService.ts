/**
 * The invoice service ties the rails together:
 *
 *   price (BTC/EUR/USD) --rate--> locked amount in sats
 *                                 |--> fresh on-chain address (xpub/ypub/zpub)
 *                                 |--> phoenixd Bolt11 invoice
 *
 * The locked sat amount and both payment destinations are fixed for the life of
 * the invoice (default 15 minutes), after which it can no longer be paid.
 *
 * Everything external (DB, rate feed, phoenixd, clock, id generation) is
 * injected so the whole flow is unit-testable without a network.
 */

import {
  fiatMinorToSat,
  parseDecimalToMinor,
  satToBtcString,
  type Currency,
  type FiatCurrency,
} from "../money.js";
import type { AddressDeriver } from "../bitcoin/derivation.js";
import type { PhoenixdClient } from "../phoenixd/client.js";
import type { RateProvider } from "../rates/provider.js";
import type {
  AccountRepository,
  Invoice,
  InvoiceRepository,
  PaidVia,
  Refund,
  RefundRepository,
} from "../db/repositories.js";
import type { EventBus, InvoiceEventType } from "../events.js";

export class InvoiceServiceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "rail_unavailable"
      | "bad_request"
      | "rate_unavailable" = "bad_request",
  ) {
    super(message);
    this.name = "InvoiceServiceError";
  }
}

export interface CreateInvoiceRequest {
  /** Amount as a decimal string in `currency` units, e.g. "9.99". */
  amount: string;
  currency: Currency;
  description?: string;
  /** Merchant's own order reference. */
  externalId?: string;
  metadata?: Record<string, unknown>;
  /** Merchant URL notified (signed) when the invoice is paid. */
  callbackUrl?: string;
  /** Per-invoice payment window in seconds (overrides the global TTL). */
  timeoutSeconds?: number;
  /** Per-invoice on-chain confirmations required before this invoice settles. */
  confirmations?: number;
}

export interface InvoiceServiceDeps {
  invoices: InvoiceRepository;
  accounts: AccountRepository;
  refunds?: RefundRepository;
  rates: RateProvider;
  deriver?: AddressDeriver;
  phoenixd?: PhoenixdClient;
  /** Invoice lifetime in seconds. A function is re-read per invoice so the
   *  admin can change it at runtime without restarting. */
  ttlSeconds: number | (() => number);
  chain: number;
  now?: () => number;
  generateId?: () => string;
  /** Base URL used to build a per-invoice phoenixd webhook, if any. */
  publicBaseUrl?: string;
  /** Event bus for lifecycle notifications (created/detected/paid/...). */
  events?: EventBus;
}

export class InvoiceService {
  private readonly deps: InvoiceServiceDeps;
  private readonly now: () => number;
  private readonly generateId: () => string;
  private accountId: number | null = null;

  constructor(deps: InvoiceServiceDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.generateId = deps.generateId ?? (() => crypto.randomUUID());

    if (deps.deriver) {
      this.accountId = deps.accounts.ensure(
        {
          fingerprint: deps.deriver.fingerprint,
          xpub: "", // we never persist the key material itself
          scriptType: deps.deriver.scriptType,
          network: deps.deriver.network,
          chain: deps.chain,
          ceiling: deps.deriver.maxIndex,
        },
        this.now(),
      );
    }
  }

  get onchainEnabled(): boolean {
    return Boolean(this.deps.deriver);
  }

  get lightningEnabled(): boolean {
    return Boolean(this.deps.phoenixd);
  }

  /** Current invoice lifetime in seconds (re-read so admin changes apply live). */
  ttlSeconds(): number {
    const ttl =
      typeof this.deps.ttlSeconds === "function"
        ? this.deps.ttlSeconds()
        : this.deps.ttlSeconds;
    if (!Number.isFinite(ttl) || ttl <= 0) return 900;
    return Math.floor(ttl);
  }

  /** Resolve the effective TTL, honouring a per-invoice override (60s–24h). */
  private resolveTtl(override?: number): number {
    if (override === undefined) return this.ttlSeconds();
    if (!Number.isFinite(override) || override < 60 || override > 86_400) {
      throw new InvoiceServiceError("timeoutSeconds must be between 60 and 86400");
    }
    return Math.floor(override);
  }

  /** Validate a per-invoice confirmations override (0–100); null = global. */
  private resolveConfirmations(override?: number): number | null {
    if (override === undefined) return null;
    if (!Number.isInteger(override) || override < 0 || override > 100) {
      throw new InvoiceServiceError("confirmations must be an integer between 0 and 100");
    }
    return override;
  }

  async create(req: CreateInvoiceRequest): Promise<Invoice> {
    if (!this.onchainEnabled && !this.lightningEnabled) {
      throw new InvoiceServiceError(
        "No payment rail configured (set BITCOIN_XPUB and/or PHOENIXD_URL)",
        "rail_unavailable",
      );
    }
    const currency = req.currency;
    const { amountSat, priceMinor, rateMinor, rateSource } = await this.computeAmount(
      req.amount,
      currency,
    );

    const id = this.generateId();
    const createdAt = this.now();
    const ttl = this.resolveTtl(req.timeoutSeconds);
    const expiresAt = createdAt + ttl * 1000;
    const requiredConfirmations = this.resolveConfirmations(req.confirmations);
    const description =
      req.description?.slice(0, 128) ?? `Invoice ${id.slice(0, 8)}`;

    // --- on-chain rail: allocate a fresh address (index overflow guarded) ---
    let onchainAccountId: number | null = null;
    let onchainAddress: string | null = null;
    let onchainIndex: number | null = null;
    let onchainChain: number | null = null;
    let onchainScript: string | null = null;
    if (this.deps.deriver && this.accountId !== null) {
      onchainAccountId = this.accountId;
      const index = this.deps.accounts.allocateIndex(this.accountId);
      const derived = this.deps.deriver.derive(index, this.deps.chain);
      onchainAddress = derived.address;
      onchainIndex = derived.index;
      onchainChain = derived.chain;
      onchainScript = derived.scriptType;
    }

    // --- lightning rail: create a Bolt11 invoice with the same expiry ---
    let lnInvoice: string | null = null;
    let lnPaymentHash: string | null = null;
    if (this.deps.phoenixd) {
      const webhookUrl = this.deps.publicBaseUrl
        ? `${this.deps.publicBaseUrl.replace(/\/$/, "")}/webhooks/phoenixd`
        : undefined;
      const created = await this.deps.phoenixd.createInvoice({
        description,
        amountSat,
        expirySeconds: ttl,
        externalId: id,
        webhookUrl,
      });
      lnInvoice = created.serialized;
      lnPaymentHash = created.paymentHash;
    }

    this.deps.invoices.insert({
      id,
      createdAt,
      expiresAt,
      priceCurrency: currency,
      priceMinor,
      rateMinor,
      rateSource,
      amountSat,
      requiredConfirmations,
      description,
      externalId: req.externalId ?? null,
      metadata: req.metadata ?? null,
      callbackUrl: req.callbackUrl ?? null,
      onchainAccountId,
      onchainAddress,
      onchainIndex,
      onchainChain,
      onchainScript,
      lnInvoice,
      lnPaymentHash,
    });

    const invoice = this.deps.invoices.get(id);
    if (!invoice) throw new Error("Invoice vanished immediately after insert");
    this.emit("invoice.created", invoice);
    return invoice;
  }

  private emit(
    type: InvoiceEventType,
    invoice: Invoice,
    detail?: Record<string, unknown>,
  ): void {
    this.deps.events?.publish({
      type,
      invoiceId: invoice.id,
      at: this.now(),
      status: invoice.status,
      amountSat: invoice.amountSat.toString(),
      externalId: invoice.externalId,
      detail,
    });
  }

  private async computeAmount(
    amount: string,
    currency: Currency,
  ): Promise<{
    amountSat: bigint;
    priceMinor: bigint;
    rateMinor: bigint | null;
    rateSource: string | null;
  }> {
    if (currency === "BTC") {
      const sat = parseDecimalToMinor(amount, "BTC"); // minor unit of BTC = sat
      return { amountSat: sat, priceMinor: sat, rateMinor: null, rateSource: null };
    }
    const fiatMinor = parseDecimalToMinor(amount, currency);
    let rateMinor: bigint;
    try {
      rateMinor = await this.deps.rates.btcPriceMinor(currency as FiatCurrency);
    } catch (err) {
      throw new InvoiceServiceError(
        `Could not fetch BTC/${currency} rate: ${String(err)}`,
        "rate_unavailable",
      );
    }
    // Lock the conversion at order time for accounting/compliance.
    const amountSat = fiatMinorToSat(fiatMinor, rateMinor);
    return {
      amountSat,
      priceMinor: fiatMinor,
      rateMinor,
      rateSource: this.deps.rates.source,
    };
  }

  get(id: string): Invoice | null {
    return this.refresh(this.deps.invoices.get(id));
  }

  /** Lazily flip an invoice to "expired" when read past its deadline. */
  private refresh(invoice: Invoice | null): Invoice | null {
    if (!invoice) return null;
    if (invoice.status === "pending" && invoice.expiresAt <= this.now()) {
      this.expireOverdue();
      return this.deps.invoices.get(invoice.id);
    }
    return invoice;
  }

  /**
   * Record that a payment was first seen unconfirmed (in the mempool, or a
   * pending Lightning HTLC). Idempotent — only the first call emits an event.
   */
  markDetected(
    id: string,
    detail?: Record<string, unknown>,
  ): Invoice | null {
    const invoice = this.deps.invoices.markDetected(id, this.now());
    if (invoice) this.emit("invoice.payment_detected", invoice, detail);
    return invoice;
  }

  /**
   * Settle an invoice, idempotently. Returns the paid invoice if this call was
   * the one that settled it, or null if it was already settled / not pending.
   */
  settle(
    id: string,
    via: PaidVia,
    amountSat: bigint,
    reference: string,
  ): Invoice | null {
    const paid = this.deps.invoices.markPaid(
      id,
      this.now(),
      via,
      amountSat,
      reference,
    );
    if (paid) {
      this.emit("invoice.paid", paid, {
        via,
        receivedSat: amountSat.toString(),
        reference,
      });
    }
    return paid;
  }

  /**
   * Record a reimbursement against an invoice. Reimbursements apply to money
   * actually received, so the invoice must be paid and the cumulative refunded
   * amount can't exceed what was received. Returns the refund and the refreshed
   * invoice. Recording the refund does NOT change the invoice status.
   */
  refund(
    id: string,
    input: { amountSat: bigint; reference?: string; note?: string },
  ): { invoice: Invoice; refund: Refund } | null {
    if (!this.deps.refunds) {
      throw new InvoiceServiceError("Refunds are not available", "rail_unavailable");
    }
    const invoice = this.deps.invoices.get(id);
    if (!invoice) return null;
    if (invoice.status !== "paid") {
      throw new InvoiceServiceError("Only a paid invoice can be reimbursed");
    }
    if (input.amountSat <= 0n) {
      throw new InvoiceServiceError("Refund amount must be positive");
    }
    const received = invoice.paidAmountSat ?? invoice.amountSat;
    if (invoice.refundedSat + input.amountSat > received) {
      throw new InvoiceServiceError(
        `Refund exceeds received amount: already ${invoice.refundedSat} + ${input.amountSat} > ${received} sat`,
      );
    }
    const { refund, refundedSat } = this.deps.refunds.add(
      id,
      input.amountSat,
      input.reference ?? null,
      input.note ?? null,
      this.now(),
    );
    const refreshed = this.deps.invoices.get(id)!;
    this.emit("invoice.refunded", refreshed, {
      amountSat: input.amountSat.toString(),
      refundedSat: refundedSat.toString(),
      reference: input.reference ?? null,
    });
    return { invoice: refreshed, refund };
  }

  listRefunds(id: string): Refund[] {
    return this.deps.refunds?.list(id) ?? [];
  }

  cancel(id: string): Invoice | null {
    const canceled = this.deps.invoices.cancel(id);
    if (canceled) {
      this.recycle(canceled);
      this.emit("invoice.canceled", canceled);
    }
    return canceled;
  }

  /**
   * Expire all overdue pending invoices and recycle their derivation indices.
   * Returns the number expired.
   */
  expireOverdue(): number {
    const expired = this.deps.invoices.expireOverdue(this.now());
    for (const inv of expired) {
      this.recycle(inv);
      this.emit("invoice.expired", inv);
    }
    return expired.length;
  }

  /** Return an abandoned invoice's on-chain index to the recycle pool. */
  private recycle(inv: Invoice): void {
    if (
      inv.onchainAccountId !== null &&
      inv.onchainIndex !== null &&
      inv.onchainAddress !== null &&
      inv.onchainScript !== null
    ) {
      this.deps.accounts.release(
        inv.onchainAccountId,
        inv.onchainIndex,
        inv.onchainAddress,
        inv.onchainScript,
        this.now(),
      );
    }
  }
}

/**
 * BIP21 unified URI combining the on-chain address (with amount) and the
 * Lightning invoice, so a single QR works in modern wallets.
 */
export function toBip21(invoice: Invoice): string | null {
  const amountBtc = satToBtcString(invoice.amountSat);
  if (invoice.onchainAddress) {
    const params = new URLSearchParams();
    params.set("amount", amountBtc);
    if (invoice.description) params.set("label", invoice.description);
    if (invoice.lnInvoice) params.set("lightning", invoice.lnInvoice.toUpperCase());
    return `bitcoin:${invoice.onchainAddress}?${params.toString()}`;
  }
  if (invoice.lnInvoice) {
    return `lightning:${invoice.lnInvoice.toUpperCase()}`;
  }
  return null;
}
