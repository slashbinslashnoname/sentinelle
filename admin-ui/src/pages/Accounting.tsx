import { useState } from "react";
import { Button, Card, Field, Input, PageHeader, Select } from "../components/ui";

// Conversion is locked at order time, so this CSV is the compliant sales record.
export function Accounting() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");

  const href = (ext: "csv" | "xlsx") => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (status) p.set("status", status);
    const qs = p.toString();
    return `/api/admin/export.${ext}${qs ? `?${qs}` : ""}`;
  };

  return (
    <div>
      <PageHeader
        title="Accounting export"
        subtitle="CSV of invoices with the fiat↔BTC conversion locked at order time — the record your bookkeeping or tax tool needs."
      />
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="paid">paid</option>
              <option value="pending">pending</option>
              <option value="expired">expired</option>
              <option value="canceled">canceled</option>
            </Select>
          </Field>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <a href={href("csv")} download>
            <Button variant="primary">Download CSV</Button>
          </a>
          <a href={href("xlsx")} download>
            <Button>Download XLSX (Excel / Numbers)</Button>
          </a>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          CSV opens in Excel, Apple Numbers and Google Sheets; XLSX is the native Excel/Numbers format. Every row has the
          fiat↔BTC rate locked at order time.
        </p>
      </Card>
    </div>
  );
}
