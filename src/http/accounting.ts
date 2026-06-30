/**
 * Accounting exports. Every row is one invoice with the fiat↔BTC conversion
 * *locked at order time*, the rate source, both fiat and BTC amounts, what was
 * actually received, and UTC timestamps — the fields a bookkeeper or tax tool
 * needs. The same row builder feeds both the CSV and the XLSX exporters so the
 * formats never drift (CSV also opens cleanly in Numbers and Google Sheets).
 */

import ExcelJS from "exceljs";
import { formatMinor, satToBtcString } from "../money.js";
import type { Invoice } from "../db/repositories.js";

export const ACCOUNTING_COLUMNS = [
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
  "refunded_sat",
  "net_sat",
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

export function invoiceRow(inv: Invoice): string[] {
  const isFiat = inv.priceCurrency !== "BTC";
  const received = inv.paidAmountSat ?? 0n;
  const net = received - inv.refundedSat;
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
    inv.refundedSat.toString(),
    inv.paidAmountSat === null ? "" : net.toString(),
    inv.paidVia ?? "",
    inv.paidReference ?? "",
    iso(inv.createdAt),
    iso(inv.detectedAt),
    iso(inv.paidAt),
    iso(inv.expiresAt),
  ];
}

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function invoicesToCsv(invoices: Invoice[]): string {
  const lines = [ACCOUNTING_COLUMNS.join(",")];
  for (const inv of invoices) lines.push(invoiceRow(inv).map(csvEscape).join(","));
  return lines.join("\r\n") + "\r\n";
}

export async function invoicesToXlsx(invoices: Invoice[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sentinelle";
  const ws = wb.addWorksheet("Invoices");
  ws.addRow(ACCOUNTING_COLUMNS as unknown as string[]);
  ws.getRow(1).font = { bold: true };
  for (const inv of invoices) ws.addRow(invoiceRow(inv));
  ws.columns.forEach((col) => {
    col.width = 18;
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
