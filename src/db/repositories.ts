/**
 * Typed repositories over the SQLite tables. All bigint money fields are stored
 * as TEXT and converted at the boundary so no precision is ever lost.
 */

import type { DB } from "./database.js";
import { IndexOverflowError } from "../bitcoin/derivation.js";
import type { Currency } from "../money.js";

export type InvoiceStatus = "pending" | "paid" | "expired" | "canceled";
export type PaidVia = "onchain" | "lightning";

export interface Invoice {
  id: string;
  status: InvoiceStatus;
  createdAt: number;
  expiresAt: number;
  detectedAt: number | null;
  paidAt: number | null;
  priceCurrency: Currency;
  priceMinor: bigint;
  rateMinor: bigint | null;
  rateSource: string | null;
  amountSat: bigint;
  description: string | null;
  externalId: string | null;
  metadata: Record<string, unknown> | null;
  callbackUrl: string | null;
  onchainAccountId: number | null;
  onchainAddress: string | null;
  onchainIndex: number | null;
  onchainChain: number | null;
  onchainScript: string | null;
  lnInvoice: string | null;
  lnPaymentHash: string | null;
  paidVia: PaidVia | null;
  paidAmountSat: bigint | null;
  paidReference: string | null;
}

interface InvoiceRow {
  id: string;
  status: string;
  created_at: number;
  expires_at: number;
  detected_at: number | null;
  paid_at: number | null;
  price_currency: string;
  price_minor: string;
  rate_minor: string | null;
  rate_source: string | null;
  amount_sat: string;
  description: string | null;
  external_id: string | null;
  metadata_json: string | null;
  callback_url: string | null;
  onchain_account_id: number | null;
  onchain_address: string | null;
  onchain_index: number | null;
  onchain_chain: number | null;
  onchain_script: string | null;
  ln_invoice: string | null;
  ln_payment_hash: string | null;
  paid_via: string | null;
  paid_amount_sat: string | null;
  paid_reference: string | null;
}

function rowToInvoice(r: InvoiceRow): Invoice {
  return {
    id: r.id,
    status: r.status as InvoiceStatus,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    detectedAt: r.detected_at,
    paidAt: r.paid_at,
    priceCurrency: r.price_currency as Currency,
    priceMinor: BigInt(r.price_minor),
    rateMinor: r.rate_minor === null ? null : BigInt(r.rate_minor),
    rateSource: r.rate_source,
    amountSat: BigInt(r.amount_sat),
    description: r.description,
    externalId: r.external_id,
    metadata: r.metadata_json ? JSON.parse(r.metadata_json) : null,
    callbackUrl: r.callback_url,
    onchainAccountId: r.onchain_account_id,
    onchainAddress: r.onchain_address,
    onchainIndex: r.onchain_index,
    onchainChain: r.onchain_chain,
    onchainScript: r.onchain_script,
    lnInvoice: r.ln_invoice,
    lnPaymentHash: r.ln_payment_hash,
    paidVia: r.paid_via as PaidVia | null,
    paidAmountSat: r.paid_amount_sat === null ? null : BigInt(r.paid_amount_sat),
    paidReference: r.paid_reference,
  };
}

export interface NewInvoice {
  id: string;
  createdAt: number;
  expiresAt: number;
  priceCurrency: Currency;
  priceMinor: bigint;
  rateMinor: bigint | null;
  rateSource: string | null;
  amountSat: bigint;
  description: string | null;
  externalId: string | null;
  metadata: Record<string, unknown> | null;
  callbackUrl: string | null;
  onchainAccountId: number | null;
  onchainAddress: string | null;
  onchainIndex: number | null;
  onchainChain: number | null;
  onchainScript: string | null;
  lnInvoice: string | null;
  lnPaymentHash: string | null;
}

export interface AccountInput {
  fingerprint: string;
  xpub: string;
  scriptType: string;
  network: string;
  chain: number;
  ceiling: number;
}

export class AccountRepository {
  constructor(private readonly db: DB) {}

  /** Ensure an account row exists for this fingerprint+chain; returns its id. */
  ensure(input: AccountInput, now: number): number {
    const existing = this.db
      .prepare(
        `SELECT id FROM accounts WHERE fingerprint = ? AND chain = ?`,
      )
      .get(input.fingerprint, input.chain) as { id: number } | undefined;
    if (existing) {
      // Keep the ceiling in sync if the operator raised/lowered it.
      this.db
        .prepare(`UPDATE accounts SET ceiling = ? WHERE id = ?`)
        .run(input.ceiling, existing.id);
      return existing.id;
    }
    const info = this.db
      .prepare(
        `INSERT INTO accounts (fingerprint, xpub, script_type, network, chain, next_index, ceiling, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        input.fingerprint,
        input.xpub,
        input.scriptType,
        input.network,
        input.chain,
        input.ceiling,
        now,
      );
    return Number(info.lastInsertRowid);
  }

  /**
   * Atomically allocate and return the next derivation index for an account.
   *
   * A recycled index from a previously abandoned invoice is reused first (lowest
   * first), so gaps left by expired/canceled invoices are filled before the
   * monotonic `next_index` advances. Only when the recycle pool is empty does it
   * hand out a brand-new index, enforcing the configured ceiling.
   *
   * Runs inside an IMMEDIATE transaction so two concurrent invoice creations can
   * never collide on the same index.
   */
  allocateIndex(accountId: number): number {
    const txn = this.db.transaction((id: number): number => {
      const recycled = this.db
        .prepare(
          `SELECT idx FROM released_indexes WHERE account_id = ? ORDER BY idx ASC LIMIT 1`,
        )
        .get(id) as { idx: number } | undefined;
      if (recycled) {
        this.db
          .prepare(`DELETE FROM released_indexes WHERE account_id = ? AND idx = ?`)
          .run(id, recycled.idx);
        return recycled.idx;
      }

      const row = this.db
        .prepare(`SELECT next_index, ceiling FROM accounts WHERE id = ?`)
        .get(id) as { next_index: number; ceiling: number } | undefined;
      if (!row) throw new Error(`Unknown account ${id}`);
      if (row.next_index > row.ceiling) {
        throw new IndexOverflowError(row.next_index, row.ceiling);
      }
      const index = row.next_index;
      this.db
        .prepare(`UPDATE accounts SET next_index = next_index + 1 WHERE id = ?`)
        .run(id);
      return index;
    });
    // better-sqlite3 transactions are synchronous; use immediate to lock early.
    return txn.immediate(accountId);
  }

  /**
   * Return an index to the recycle pool so a future invoice can reuse it.
   * Idempotent: releasing the same index twice is a no-op.
   */
  release(
    accountId: number,
    index: number,
    address: string,
    scriptType: string,
    now: number,
  ): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO released_indexes (account_id, idx, address, script_type, released_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(accountId, index, address, scriptType, now);
  }

  peekNextIndex(accountId: number): number {
    const row = this.db
      .prepare(`SELECT next_index FROM accounts WHERE id = ?`)
      .get(accountId) as { next_index: number } | undefined;
    if (!row) throw new Error(`Unknown account ${accountId}`);
    return row.next_index;
  }

  recycledCount(accountId: number): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM released_indexes WHERE account_id = ?`)
      .get(accountId) as { n: number };
    return row.n;
  }
}

export class InvoiceRepository {
  constructor(private readonly db: DB) {}

  insert(inv: NewInvoice): void {
    this.db
      .prepare(
        `INSERT INTO invoices (
          id, status, created_at, expires_at, paid_at,
          price_currency, price_minor, rate_minor, rate_source, amount_sat,
          description, external_id, metadata_json, callback_url,
          onchain_account_id, onchain_address, onchain_index, onchain_chain, onchain_script,
          ln_invoice, ln_payment_hash,
          paid_via, paid_amount_sat, paid_reference
        ) VALUES (
          @id, 'pending', @createdAt, @expiresAt, NULL,
          @priceCurrency, @priceMinor, @rateMinor, @rateSource, @amountSat,
          @description, @externalId, @metadata, @callbackUrl,
          @onchainAccountId, @onchainAddress, @onchainIndex, @onchainChain, @onchainScript,
          @lnInvoice, @lnPaymentHash,
          NULL, NULL, NULL
        )`,
      )
      .run({
        id: inv.id,
        createdAt: inv.createdAt,
        expiresAt: inv.expiresAt,
        priceCurrency: inv.priceCurrency,
        priceMinor: inv.priceMinor.toString(),
        rateMinor: inv.rateMinor === null ? null : inv.rateMinor.toString(),
        rateSource: inv.rateSource,
        amountSat: inv.amountSat.toString(),
        description: inv.description,
        externalId: inv.externalId,
        metadata: inv.metadata ? JSON.stringify(inv.metadata) : null,
        callbackUrl: inv.callbackUrl,
        onchainAccountId: inv.onchainAccountId,
        onchainAddress: inv.onchainAddress,
        onchainIndex: inv.onchainIndex,
        onchainChain: inv.onchainChain,
        onchainScript: inv.onchainScript,
        lnInvoice: inv.lnInvoice,
        lnPaymentHash: inv.lnPaymentHash,
      });
  }

  get(id: string): Invoice | null {
    const row = this.db
      .prepare(`SELECT * FROM invoices WHERE id = ?`)
      .get(id) as InvoiceRow | undefined;
    return row ? rowToInvoice(row) : null;
  }

  findByLnPaymentHash(hash: string): Invoice | null {
    const row = this.db
      .prepare(`SELECT * FROM invoices WHERE ln_payment_hash = ?`)
      .get(hash) as InvoiceRow | undefined;
    return row ? rowToInvoice(row) : null;
  }

  findByExternalId(externalId: string): Invoice[] {
    const rows = this.db
      .prepare(`SELECT * FROM invoices WHERE external_id = ? ORDER BY created_at DESC`)
      .all(externalId) as InvoiceRow[];
    return rows.map(rowToInvoice);
  }

  /** Pending invoices that have one of the given rails, for the watchers. */
  listPending(): Invoice[] {
    const rows = this.db
      .prepare(`SELECT * FROM invoices WHERE status = 'pending' ORDER BY created_at ASC`)
      .all() as InvoiceRow[];
    return rows.map(rowToInvoice);
  }

  list(opts: { status?: InvoiceStatus; limit: number; offset: number }): Invoice[] {
    const limit = Math.max(1, Math.min(opts.limit, 500));
    const offset = Math.max(0, opts.offset);
    const rows = opts.status
      ? (this.db
          .prepare(
            `SELECT * FROM invoices WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          )
          .all(opts.status, limit, offset) as InvoiceRow[])
      : (this.db
          .prepare(`SELECT * FROM invoices ORDER BY created_at DESC LIMIT ? OFFSET ?`)
          .all(limit, offset) as InvoiceRow[]);
    return rows.map(rowToInvoice);
  }

  /**
   * All invoices created within [from, to], optionally filtered by status,
   * ordered oldest-first — the chronological order accounting wants.
   */
  listForExport(opts: { from: number; to: number; status?: InvoiceStatus }): Invoice[] {
    const rows = opts.status
      ? (this.db
          .prepare(
            `SELECT * FROM invoices WHERE created_at BETWEEN ? AND ? AND status = ? ORDER BY created_at ASC`,
          )
          .all(opts.from, opts.to, opts.status) as InvoiceRow[])
      : (this.db
          .prepare(
            `SELECT * FROM invoices WHERE created_at BETWEEN ? AND ? ORDER BY created_at ASC`,
          )
          .all(opts.from, opts.to) as InvoiceRow[]);
    return rows.map(rowToInvoice);
  }

  counts(): Record<InvoiceStatus, number> {
    const rows = this.db
      .prepare(`SELECT status, COUNT(*) AS n FROM invoices GROUP BY status`)
      .all() as { status: InvoiceStatus; n: number }[];
    const out: Record<InvoiceStatus, number> = {
      pending: 0,
      paid: 0,
      expired: 0,
      canceled: 0,
    };
    for (const r of rows) out[r.status] = r.n;
    return out;
  }

  /**
   * Record that a payment was first seen unconfirmed (mempool / LN pending).
   * Conditional on detected_at IS NULL so it only fires once. Returns the
   * updated invoice, or null if it was already detected or not pending.
   */
  markDetected(id: string, at: number): Invoice | null {
    const info = this.db
      .prepare(
        `UPDATE invoices SET detected_at = ?
          WHERE id = ? AND status = 'pending' AND detected_at IS NULL`,
      )
      .run(at, id);
    if (info.changes === 0) return null;
    return this.get(id);
  }

  /**
   * Mark a pending invoice paid. Conditional on status='pending' so a webhook
   * and a poller racing to settle the same invoice only succeed once.
   * Returns the updated invoice, or null if it was not pending.
   */
  markPaid(
    id: string,
    paidAt: number,
    via: PaidVia,
    amountSat: bigint,
    reference: string,
  ): Invoice | null {
    const info = this.db
      .prepare(
        `UPDATE invoices
            SET status = 'paid', paid_at = ?, paid_via = ?, paid_amount_sat = ?, paid_reference = ?
          WHERE id = ? AND status = 'pending'`,
      )
      .run(paidAt, via, amountSat.toString(), reference, id);
    if (info.changes === 0) return null;
    return this.get(id);
  }

  /**
   * Expire pending invoices past their deadline, returning the ones that
   * transitioned so the caller can recycle their derivation indices.
   */
  expireOverdue(now: number): Invoice[] {
    const txn = this.db.transaction((ts: number): Invoice[] => {
      const rows = this.db
        .prepare(
          `SELECT * FROM invoices WHERE status = 'pending' AND expires_at <= ?`,
        )
        .all(ts) as InvoiceRow[];
      if (rows.length > 0) {
        this.db
          .prepare(
            `UPDATE invoices SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?`,
          )
          .run(ts);
      }
      return rows.map(rowToInvoice);
    });
    return txn.immediate(now);
  }

  cancel(id: string): Invoice | null {
    const info = this.db
      .prepare(
        `UPDATE invoices SET status = 'canceled' WHERE id = ? AND status = 'pending'`,
      )
      .run(id);
    if (info.changes === 0) return null;
    return this.get(id);
  }
}

/** Runtime-editable key/value settings (admin-configurable). */
export class SettingsRepository {
  constructor(private readonly db: DB) {}

  get(key: string): string | null {
    const row = this.db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  getNumber(key: string, fallback: number): number {
    const raw = this.get(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  set(key: string, value: string, now: number): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, now);
  }
}
