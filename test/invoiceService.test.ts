import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase, type DB } from "../src/db/database.js";
import {
  AccountRepository,
  InvoiceRepository,
  RefundRepository,
} from "../src/db/repositories.js";
import { AddressDeriver } from "../src/bitcoin/derivation.js";
import { InvoiceService } from "../src/core/invoiceService.js";
import { EventBus, type InvoiceEvent } from "../src/events.js";
import { FixedRateProvider } from "../src/rates/fixed.js";
import type {
  CreateInvoiceParams,
  CreatedInvoice,
  IncomingPayment,
  NodeInfo,
  PhoenixdClient,
} from "../src/phoenixd/client.js";

const ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";

class FakePhoenixd implements PhoenixdClient {
  public created: CreateInvoiceParams[] = [];
  async createInvoice(p: CreateInvoiceParams): Promise<CreatedInvoice> {
    this.created.push(p);
    return {
      amountSat: Number(p.amountSat),
      paymentHash: `hash-${this.created.length}`,
      serialized: `lnbc${this.created.length}`,
    };
  }
  async getIncomingPayment(): Promise<IncomingPayment | null> {
    return null;
  }
  async getInfo(): Promise<NodeInfo> {
    return { nodeId: "node" };
  }
}

function setup(opts: { ttl?: number; ceiling?: number; withLn?: boolean } = {}) {
  const db: DB = openDatabase(":memory:");
  const invoices = new InvoiceRepository(db);
  const accounts = new AccountRepository(db);
  const refunds = new RefundRepository(db);
  const events = new EventBus();
  const captured: InvoiceEvent[] = [];
  events.subscribe((e) => captured.push(e));

  let now = 1_000_000;
  const clock = () => now;
  const setNow = (n: number) => (now = n);

  let ttl = opts.ttl ?? 900;
  const phoenixd = opts.withLn ? new FakePhoenixd() : undefined;

  const service = new InvoiceService({
    invoices,
    accounts,
    refunds,
    rates: new FixedRateProvider({ EUR: "50000", USD: "60000" }),
    deriver: new AddressDeriver(ZPUB, opts.ceiling ?? 1_000_000),
    phoenixd,
    ttlSeconds: () => ttl,
    chain: 0,
    now: clock,
    events,
  });

  return {
    service,
    invoices,
    accounts,
    captured,
    setNow,
    setTtl: (n: number) => (ttl = n),
    phoenixd,
  };
}

describe("InvoiceService.create", () => {
  it("prices a EUR invoice via the rate and locks the sat amount", async () => {
    const { service } = setup();
    // 1 BTC = 50,000 EUR. 10.00 EUR => 1000 cents => 1000*1e8/5_000_000 = 20000 sat
    const inv = await service.create({ amount: "10.00", currency: "EUR" });
    expect(inv.amountSat).toBe(20_000n);
    expect(inv.priceCurrency).toBe("EUR");
    expect(inv.rateMinor).toBe(5_000_000n);
    expect(inv.onchainAddress).toBe(
      "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
    );
  });

  it("accepts a BTC-denominated price directly", async () => {
    const { service } = setup();
    const inv = await service.create({ amount: "0.00012345", currency: "BTC" });
    expect(inv.amountSat).toBe(12_345n);
    expect(inv.rateMinor).toBeNull();
  });

  it("derives a fresh address per invoice and advances the index", async () => {
    const { service } = setup();
    const a = await service.create({ amount: "1", currency: "BTC" });
    const b = await service.create({ amount: "1", currency: "BTC" });
    expect(a.onchainIndex).toBe(0);
    expect(b.onchainIndex).toBe(1);
    expect(a.onchainAddress).not.toBe(b.onchainAddress);
  });

  it("creates a matching Lightning invoice when phoenixd is configured", async () => {
    const { service, phoenixd } = setup({ withLn: true });
    const inv = await service.create({ amount: "1", currency: "BTC" });
    expect(inv.lnInvoice).toBe("lnbc1");
    expect(inv.lnPaymentHash).toBe("hash-1");
    expect(phoenixd!.created[0]!.externalId).toBe(inv.id);
    expect(phoenixd!.created[0]!.amountSat).toBe(100_000_000n);
  });

  it("emits invoice.created", async () => {
    const { service, captured } = setup();
    const inv = await service.create({ amount: "1", currency: "BTC" });
    expect(captured.map((e) => e.type)).toContain("invoice.created");
    expect(captured[0]!.invoiceId).toBe(inv.id);
  });

  it("accepts a per-invoice timeout and confirmations override", async () => {
    const { service } = setup({ ttl: 900 });
    const inv = await service.create({
      amount: "1",
      currency: "BTC",
      timeoutSeconds: 120,
      confirmations: 3,
    });
    expect(inv.expiresAt - inv.createdAt).toBe(120_000);
    expect(inv.requiredConfirmations).toBe(3);
  });

  it("defaults requiredConfirmations to null (use global policy)", async () => {
    const { service } = setup();
    const inv = await service.create({ amount: "1", currency: "BTC" });
    expect(inv.requiredConfirmations).toBeNull();
  });

  it("rejects out-of-range timeout and confirmations", async () => {
    const { service } = setup();
    await expect(service.create({ amount: "1", currency: "BTC", timeoutSeconds: 10 })).rejects.toThrow(
      /timeoutSeconds/,
    );
    await expect(service.create({ amount: "1", currency: "BTC", confirmations: 999 })).rejects.toThrow(
      /confirmations/,
    );
  });

  it("honours a TTL changed at runtime", async () => {
    const { service, setTtl } = setup({ ttl: 900 });
    const a = await service.create({ amount: "1", currency: "BTC" });
    expect(a.expiresAt - a.createdAt).toBe(900_000);
    setTtl(60);
    const b = await service.create({ amount: "1", currency: "BTC" });
    expect(b.expiresAt - b.createdAt).toBe(60_000);
  });
});

describe("InvoiceService settlement & expiry", () => {
  it("settles idempotently and emits invoice.paid once", async () => {
    const { service, captured } = setup();
    const inv = await service.create({ amount: "1", currency: "BTC" });
    const paid = service.settle(inv.id, "onchain", 100_000_000n, "txid");
    expect(paid?.status).toBe("paid");
    const again = service.settle(inv.id, "onchain", 100_000_000n, "txid");
    expect(again).toBeNull();
    expect(captured.filter((e) => e.type === "invoice.paid")).toHaveLength(1);
  });

  it("emits payment_detected once", async () => {
    const { service, captured } = setup();
    const inv = await service.create({ amount: "1", currency: "BTC" });
    service.markDetected(inv.id, { via: "onchain" });
    service.markDetected(inv.id, { via: "onchain" });
    expect(
      captured.filter((e) => e.type === "invoice.payment_detected"),
    ).toHaveLength(1);
  });

  it("expires overdue invoices and recycles their index", async () => {
    const { service, accounts, setNow } = setup({ ttl: 900 });
    const inv = await service.create({ amount: "1", currency: "BTC" });
    expect(inv.onchainIndex).toBe(0);
    // Account id is 1 (first ensured). Move clock past expiry.
    setNow(1_000_000 + 901_000);
    const n = service.expireOverdue();
    expect(n).toBe(1);
    expect(service.get(inv.id)!.status).toBe("expired");
    // The freed index is reused by the next invoice.
    const next = await service.create({ amount: "1", currency: "BTC" });
    expect(next.onchainIndex).toBe(0);
    expect(accounts.recycledCount(1)).toBe(0);
  });

  it("records reimbursements without changing status, and caps at received", async () => {
    const { service, captured } = setup();
    const inv = await service.create({ amount: "1", currency: "BTC" });
    service.settle(inv.id, "onchain", 100_000_000n, "txid");

    const r1 = service.refund(inv.id, { amountSat: 40_000_000n, reference: "ref1" });
    expect(r1?.invoice.refundedSat).toBe(40_000_000n);
    expect(r1?.invoice.status).toBe("paid"); // status unchanged
    const r2 = service.refund(inv.id, { amountSat: 60_000_000n });
    expect(r2?.invoice.refundedSat).toBe(100_000_000n);
    expect(service.listRefunds(inv.id)).toHaveLength(2);
    expect(captured.filter((e) => e.type === "invoice.refunded")).toHaveLength(2);

    // Over-refund is rejected.
    expect(() => service.refund(inv.id, { amountSat: 1n })).toThrow(/exceeds received/);
  });

  it("refuses to reimburse an unpaid invoice", async () => {
    const { service } = setup();
    const inv = await service.create({ amount: "1", currency: "BTC" });
    expect(() => service.refund(inv.id, { amountSat: 1n })).toThrow(/paid invoice/);
  });

  it("recycles the index when an invoice is canceled", async () => {
    const { service } = setup();
    const inv = await service.create({ amount: "1", currency: "BTC" });
    service.cancel(inv.id);
    const next = await service.create({ amount: "1", currency: "BTC" });
    expect(next.onchainIndex).toBe(inv.onchainIndex);
  });

  it("lazily expires when read past the deadline", async () => {
    const { service, setNow } = setup({ ttl: 60 });
    const inv = await service.create({ amount: "1", currency: "BTC" });
    setNow(1_000_000 + 61_000);
    expect(service.get(inv.id)!.status).toBe("expired");
  });

  it("does not settle an already-expired invoice", async () => {
    const { service, setNow } = setup({ ttl: 60 });
    const inv = await service.create({ amount: "1", currency: "BTC" });
    setNow(1_000_000 + 61_000);
    service.get(inv.id); // triggers lazy expiry
    expect(service.settle(inv.id, "onchain", 1n, "txid")).toBeNull();
  });
});
