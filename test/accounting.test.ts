import { describe, it, expect } from "vitest";
import { invoicesToCsv } from "../src/http/accounting.js";
import type { Invoice } from "../src/db/repositories.js";

function inv(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    status: "paid",
    createdAt: 1700000000000,
    expiresAt: 1700000900000,
    detectedAt: 1700000100000,
    paidAt: 1700000200000,
    priceCurrency: "EUR",
    priceMinor: 1999n, // 19.99 EUR
    rateMinor: 5_000_000n, // 50,000.00 EUR / BTC
    rateSource: "mempool",
    amountSat: 39980n,
    description: "Order, with comma",
    externalId: "order-42",
    metadata: null,
    callbackUrl: null,
    onchainAccountId: 1,
    onchainAddress: "bc1qexample",
    onchainIndex: 0,
    onchainChain: 0,
    onchainScript: "p2wpkh",
    lnInvoice: null,
    lnPaymentHash: null,
    paidVia: "onchain",
    paidAmountSat: 39980n,
    paidReference: "txid123",
    ...overrides,
  };
}

describe("invoicesToCsv", () => {
  it("emits a header and locks the conversion fields", () => {
    const csv = invoicesToCsv([inv()]);
    const [header, row] = csv.trim().split("\r\n");
    expect(header).toContain("order_currency,order_amount,btc_unit_price,rate_source");
    // 19.99 EUR order, 50000.00 unit price, locked
    expect(row).toContain("EUR,19.99,50000.00,mempool");
    expect(row).toContain("0.00039980,39980,39980,onchain,txid123");
    expect(row).toContain("order-42");
  });

  it("renders ISO UTC timestamps", () => {
    const csv = invoicesToCsv([inv()]);
    expect(csv).toContain("2023-11-14T22:13:20.000Z"); // createdAt
  });

  it("leaves rate columns blank for BTC-priced invoices", () => {
    const csv = invoicesToCsv([
      inv({ priceCurrency: "BTC", priceMinor: 50000n, rateMinor: null, rateSource: null }),
    ]);
    const row = csv.trim().split("\r\n")[1]!;
    expect(row).toContain("BTC,0.00050000,,"); // order_amount then empty unit price + source
  });
});
