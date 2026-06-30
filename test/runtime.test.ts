import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase } from "../src/db/database.js";
import {
  AccountRepository,
  InvoiceRepository,
  RefundRepository,
  SettingsRepository,
  type NewInvoice,
} from "../src/db/repositories.js";
import { AppSettings, SETTING_KEYS } from "../src/settings.js";
import { EventBus } from "../src/events.js";
import { Runtime } from "../src/runtime.js";
import { AddressDeriver } from "../src/bitcoin/derivation.js";

const ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";

const deriver = new AddressDeriver(ZPUB);
const addrAt = (i: number) => deriver.derive(i, 0).address;

/** Fake explorer: addresses in `used` report on-chain history, others are empty. */
function makeFetch(used: Set<string>): typeof fetch {
  return (async (url: string | URL) => {
    const addr = String(url).split("/api/address/")[1] ?? "";
    const hit = used.has(addr);
    const body = {
      chain_stats: { funded_txo_sum: hit ? 10_000 : 0, tx_count: hit ? 1 : 0 },
      mempool_stats: { funded_txo_sum: 0, tx_count: 0 },
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("Runtime on-chain index tools", () => {
  let accounts: AccountRepository;
  let invoices: InvoiceRepository;
  let runtime: Runtime;
  let used: Set<string>;
  let accountId: number;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    invoices = new InvoiceRepository(db);
    accounts = new AccountRepository(db);
    const refunds = new RefundRepository(db);
    const settingsRepo = new SettingsRepository(db);
    settingsRepo.set(SETTING_KEYS.xpub, ZPUB, 1);
    settingsRepo.set(SETTING_KEYS.explorerUrl, "https://explorer.test", 1);
    const settings = new AppSettings(settingsRepo);
    used = new Set<string>();
    runtime = new Runtime(settings, invoices, accounts, refunds, new EventBus(), makeFetch(used));
    // Idempotent ensure() returns the same id the runtime resolves internally.
    accountId = accounts.ensure(
      {
        fingerprint: deriver.fingerprint,
        xpub: "",
        scriptType: deriver.scriptType,
        network: deriver.network,
        chain: 0,
        ceiling: deriver.maxIndex,
      },
      1,
    );
  });

  const pendingInvoice = (id: string, index: number): NewInvoice => ({
    id,
    createdAt: 1,
    expiresAt: 10_000_000_000_000,
    priceCurrency: "EUR",
    priceMinor: 999n,
    rateMinor: 5_000_000n,
    rateSource: "fixed",
    amountSat: 20_000n,
    description: null,
    externalId: null,
    metadata: null,
    callbackUrl: null,
    onchainAccountId: accountId,
    onchainAddress: addrAt(index),
    onchainIndex: index,
    onchainChain: 0,
    onchainScript: deriver.scriptType,
    lnInvoice: null,
    lnPaymentHash: null,
  });

  it("raises the next index without an explorer scan", async () => {
    const r = await runtime.setNextIndex(10);
    expect(r.ok).toBe(true);
    expect(r.nextIndex).toBe(10);
    expect(accounts.peekNextIndex(accountId)).toBe(10);
  });

  it("proposes the current index when its address is unused", async () => {
    await runtime.setNextIndex(3); // address 3 has no history in `used`
    const r = await runtime.findNextEmptyIndex();
    expect(r.ok).toBe(true);
    expect(r.index).toBe(3);
    expect(accounts.peekNextIndex(accountId)).toBe(3); // read-only, unchanged
  });

  it("skips forward over indexes that already have on-chain history", async () => {
    await runtime.setNextIndex(3);
    // A reused wallet: indexes 3..24 already have history, 25 is fresh.
    for (let i = 3; i < 25; i++) used.add(addrAt(i));

    const r = await runtime.findNextEmptyIndex();
    expect(r.ok).toBe(true);
    expect(r.index).toBe(25);
    expect(r.scanned).toBe(23); // checked 3..25 inclusive
  });

  it("skip-back protection blocks lowering onto a used index", async () => {
    await runtime.setNextIndex(10);
    used.add(addrAt(5));

    const r = await runtime.setNextIndex(3);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("5");
    expect(accounts.peekNextIndex(accountId)).toBe(10); // unchanged
  });

  it("skip-back protection blocks lowering onto a pending-invoice index", async () => {
    await runtime.setNextIndex(10);
    invoices.insert(pendingInvoice("inv-pending", 6));

    const r = await runtime.setNextIndex(3);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/pending/i);
    expect(accounts.peekNextIndex(accountId)).toBe(10);
  });

  it("allows lowering when the re-exposed range is clean", async () => {
    await runtime.setNextIndex(10); // all addresses empty, no pending invoices
    const r = await runtime.setNextIndex(3);
    expect(r.ok).toBe(true);
    expect(accounts.peekNextIndex(accountId)).toBe(3);
  });
});
