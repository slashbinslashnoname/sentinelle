import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase, type DB } from "../src/db/database.js";
import {
  AccountRepository,
  InvoiceRepository,
  SettingsRepository,
  type NewInvoice,
} from "../src/db/repositories.js";
import { IndexOverflowError } from "../src/bitcoin/derivation.js";

function makeAccount(accounts: AccountRepository, ceiling: number): number {
  return accounts.ensure(
    {
      fingerprint: "deadbeef",
      xpub: "",
      scriptType: "p2wpkh",
      network: "mainnet",
      chain: 0,
      ceiling,
    },
    1000,
  );
}

describe("AccountRepository index allocation", () => {
  let db: DB;
  let accounts: AccountRepository;

  beforeEach(() => {
    db = openDatabase(":memory:");
    accounts = new AccountRepository(db);
  });

  it("hands out monotonically increasing indices", () => {
    const id = makeAccount(accounts, 1000);
    expect(accounts.allocateIndex(id)).toBe(0);
    expect(accounts.allocateIndex(id)).toBe(1);
    expect(accounts.allocateIndex(id)).toBe(2);
    expect(accounts.peekNextIndex(id)).toBe(3);
  });

  it("throws IndexOverflowError past the ceiling", () => {
    const id = makeAccount(accounts, 1);
    expect(accounts.allocateIndex(id)).toBe(0);
    expect(accounts.allocateIndex(id)).toBe(1);
    expect(() => accounts.allocateIndex(id)).toThrow(IndexOverflowError);
  });

  it("recycles released indices, lowest first, before advancing", () => {
    const id = makeAccount(accounts, 1000);
    const a = accounts.allocateIndex(id); // 0
    const b = accounts.allocateIndex(id); // 1
    const c = accounts.allocateIndex(id); // 2
    expect([a, b, c]).toEqual([0, 1, 2]);

    // Abandon 1 then 0.
    accounts.release(id, 1, "addr1", "p2wpkh", 2000);
    accounts.release(id, 0, "addr0", "p2wpkh", 2001);
    expect(accounts.recycledCount(id)).toBe(2);

    // Next allocations fill the gap with the lowest free index first.
    expect(accounts.allocateIndex(id)).toBe(0);
    expect(accounts.allocateIndex(id)).toBe(1);
    expect(accounts.recycledCount(id)).toBe(0);
    // Only once the pool is empty does next_index advance.
    expect(accounts.allocateIndex(id)).toBe(3);
  });

  it("release is idempotent", () => {
    const id = makeAccount(accounts, 1000);
    accounts.release(id, 5, "addr5", "p2wpkh", 1);
    accounts.release(id, 5, "addr5", "p2wpkh", 2);
    expect(accounts.recycledCount(id)).toBe(1);
  });

  it("setNextIndex moves the counter and prunes recycled indexes at/above it", () => {
    const id = makeAccount(accounts, 1000);
    for (let i = 0; i < 5; i++) accounts.allocateIndex(id); // next_index = 5
    accounts.release(id, 2, "addr2", "p2wpkh", 1);
    accounts.release(id, 4, "addr4", "p2wpkh", 1);
    expect(accounts.releasedIndexes(id)).toEqual([2, 4]);

    // Lower to 3: index 4 (>= 3) is pruned from the pool, 2 stays.
    accounts.setNextIndex(id, 3);
    expect(accounts.peekNextIndex(id)).toBe(3);
    expect(accounts.releasedIndexes(id)).toEqual([2]);

    // No double-issue: pool gives 2, then the counter advances from 3.
    expect(accounts.allocateIndex(id)).toBe(2);
    expect(accounts.allocateIndex(id)).toBe(3);
    expect(accounts.allocateIndex(id)).toBe(4);
  });

  it("setNextIndex can raise the counter, leaving a gap", () => {
    const id = makeAccount(accounts, 1000);
    accounts.allocateIndex(id); // 0
    accounts.setNextIndex(id, 50);
    expect(accounts.peekNextIndex(id)).toBe(50);
    expect(accounts.allocateIndex(id)).toBe(50);
  });

  it("setNextIndex rejects negatives", () => {
    const id = makeAccount(accounts, 1000);
    expect(() => accounts.setNextIndex(id, -1)).toThrow();
  });
});

describe("InvoiceRepository", () => {
  let db: DB;
  let invoices: InvoiceRepository;

  beforeEach(() => {
    db = openDatabase(":memory:");
    invoices = new InvoiceRepository(db);
  });

  const base: NewInvoice = {
    id: "inv-1",
    createdAt: 1000,
    expiresAt: 2000,
    priceCurrency: "EUR",
    priceMinor: 999n,
    rateMinor: 5_000_000n,
    rateSource: "fixed",
    amountSat: 20_000n,
    description: "test",
    externalId: "order-1",
    metadata: { foo: "bar" },
    callbackUrl: null,
    onchainAccountId: 7,
    onchainAddress: "bc1qexample",
    onchainIndex: 3,
    onchainChain: 0,
    onchainScript: "p2wpkh",
    lnInvoice: "lnbc...",
    lnPaymentHash: "hash-1",
  };

  it("round-trips bigint money fields without precision loss", () => {
    invoices.insert({ ...base, amountSat: 2_100_000_000_000_000n });
    const got = invoices.get("inv-1")!;
    expect(got.amountSat).toBe(2_100_000_000_000_000n);
    expect(got.metadata).toEqual({ foo: "bar" });
    expect(got.status).toBe("pending");
  });

  it("settles only once (idempotent markPaid)", () => {
    invoices.insert(base);
    const first = invoices.markPaid("inv-1", 1500, "lightning", 20_000n, "hash-1");
    expect(first?.status).toBe("paid");
    const second = invoices.markPaid("inv-1", 1600, "lightning", 20_000n, "hash-1");
    expect(second).toBeNull();
  });

  it("marks detected only once", () => {
    invoices.insert(base);
    expect(invoices.markDetected("inv-1", 1400)?.detectedAt).toBe(1400);
    expect(invoices.markDetected("inv-1", 1450)).toBeNull();
  });

  it("expires overdue invoices and returns them", () => {
    invoices.insert(base);
    const expired = invoices.expireOverdue(2000);
    expect(expired).toHaveLength(1);
    expect(expired[0]!.id).toBe("inv-1");
    expect(invoices.get("inv-1")!.status).toBe("expired");
    // A paid invoice is never expired.
    invoices.insert({ ...base, id: "inv-2" });
    invoices.markPaid("inv-2", 1500, "onchain", 20_000n, "ref");
    expect(invoices.expireOverdue(9999)).toHaveLength(0);
  });

  it("finds by external id and ln hash", () => {
    invoices.insert(base);
    expect(invoices.findByExternalId("order-1")).toHaveLength(1);
    expect(invoices.findByLnPaymentHash("hash-1")?.id).toBe("inv-1");
  });

  it("lists on-chain indexes locked by pending invoices for an account", () => {
    invoices.insert({ ...base, id: "inv-1", onchainAccountId: 7, onchainIndex: 3 });
    invoices.insert({ ...base, id: "inv-2", onchainAccountId: 7, onchainIndex: 8 });
    // A different account, and a paid invoice, are both excluded.
    invoices.insert({ ...base, id: "inv-3", onchainAccountId: 9, onchainIndex: 4 });
    invoices.insert({ ...base, id: "inv-4", onchainAccountId: 7, onchainIndex: 5 });
    invoices.markPaid("inv-4", 1500, "onchain", 20_000n, "ref");

    expect(invoices.pendingOnchainIndexes(7).sort((a, b) => a - b)).toEqual([3, 8]);
  });
});

describe("SettingsRepository", () => {
  it("stores and overwrites values", () => {
    const db = openDatabase(":memory:");
    const s = new SettingsRepository(db);
    expect(s.get("k")).toBeNull();
    s.set("k", "v1", 1);
    expect(s.get("k")).toBe("v1");
    s.set("k", "v2", 2);
    expect(s.get("k")).toBe("v2");
    expect(s.getNumber("n", 42)).toBe(42);
    s.set("n", "7", 3);
    expect(s.getNumber("n", 42)).toBe(7);
  });
});
