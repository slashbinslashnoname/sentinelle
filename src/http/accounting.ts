/**
 * Accounting export. Produces a CSV where every row is one invoice with the
 * fiat↔BTC conversion *locked at order time*, the rate source, both fiat and
 * BTC amounts, what was actually received, and UTC timestamps — the fields a
 * bookkeeper or tax tool needs.
 */

import { formatMinor, satToBtcString } from "../money.js";
import type { Invoice } from "../db/repositories.js";

const COLUMNS = [
  "invoice_id",
  "external_id",
  "status",
  "order_currency",
  "order_amount",
  "btc_unit_price",
  "rate_source",
  "amount_btc",
  "amount_sat",
  "received_sat",
  "paid_via",
  "paid_reference",
  "created_at_utc",
  "detected_at_utc",
  "paid_at_utc",
  "expires_at_utc",
] as const;

function iso(ms: number | null): string {
  return ms === null ? "" : new Date(ms).toISOString();
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function row(inv: Invoice): string[] {
  const isFiat = inv.priceCurrency !== "BTC";
  return [
    inv.id,
    inv.externalId ?? "",
    inv.status,
    inv.priceCurrency,
    formatMinor(inv.priceMinor, inv.priceCurrency),
    isFiat && inv.rateMinor !== null ? formatMinor(inv.rateMinor, inv.priceCurrency) : "",
    inv.rateSource ?? "",
    satToBtcString(inv.amountSat),
    inv.amountSat.toString(),
    inv.paidAmountSat === null ? "" : inv.paidAmountSat.toString(),
    inv.paidVia ?? "",
    inv.paidReference ?? "",
    iso(inv.createdAt),
    iso(inv.detectedAt),
    iso(inv.paidAt),
    iso(inv.expiresAt),
  ];
}

export function invoicesToCsv(invoices: Invoice[]): string {
  const lines = [COLUMNS.join(",")];
  for (const inv of invoices) {
    lines.push(row(inv).map(csvEscape).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
