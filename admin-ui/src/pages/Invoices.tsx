import { useEffect, useMemo, useState } from "react";
import { api, type InvoiceView } from "../lib/api";
import { Badge, Button, Card, PageHeader, Select } from "../components/ui";
import { RefundModal } from "../components/RefundModal";

type SortKey = "id" | "status" | "amountSat" | "currency" | "price" | "rateSource" | "refunded" | "createdAt";
type Dir = "asc" | "desc";

interface Column {
  key: SortKey;
  label: string;
  numeric?: boolean;
  value: (i: InvoiceView) => string | number;
  render: (i: InvoiceView) => React.ReactNode;
}

const COLUMNS: Column[] = [
  { key: "id", label: "ID", value: (i) => i.id, render: (i) => <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">{i.id.slice(0, 8)}</code> },
  { key: "status", label: "Status", value: (i) => i.status, render: (i) => <Badge status={i.status} /> },
  { key: "amountSat", label: "Amount", numeric: true, value: (i) => Number(i.amountSat), render: (i) => `${i.amountBtc} BTC` },
  { key: "currency", label: "Currency", value: (i) => i.price.currency, render: (i) => i.price.currency },
  {
    key: "price",
    label: "Price",
    numeric: true,
    value: (i) => (i.price.currency === "BTC" ? Number(i.amountSat) : Number(i.price.minor)),
    render: (i) => (i.price.currency === "BTC" ? "—" : `${(Number(i.price.minor) / 100).toFixed(2)} ${i.price.currency}`),
  },
  { key: "rateSource", label: "Rate src", value: (i) => i.rateSource ?? "", render: (i) => i.rateSource ?? "—" },
  {
    key: "refunded",
    label: "Refunded",
    numeric: true,
    value: (i) => Number(i.refundedSat ?? "0"),
    render: (i) =>
      Number(i.refundedSat ?? "0") > 0 ? (
        <span className="text-primary-600 dark:text-primary-500">
          {(Number(i.refundedSat) / 1e8).toFixed(8)}
        </span>
      ) : (
        "—"
      ),
  },
  {
    key: "createdAt",
    label: "Created",
    numeric: true,
    value: (i) => i.createdAt,
    render: (i) => new Date(i.createdAt).toISOString().slice(0, 16).replace("T", " "),
  },
];

export function Invoices() {
  const [list, setList] = useState<InvoiceView[]>([]);
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: "createdAt", dir: "desc" });
  const [refundFor, setRefundFor] = useState<InvoiceView | null>(null);

  const load = () => api.invoices(status || undefined).then(setList).catch(() => {});
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key)!;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * factor;
      return String(va).localeCompare(String(vb)) * factor;
    });
  }, [list, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const exportHref = (ext: "csv" | "xlsx") =>
    `/api/admin/export.${ext}${status ? `?status=${status}` : ""}`;

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="Click a column header to sort. Export for accounting, or consolidate a payment manually."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
              <option value="">All statuses</option>
              <option value="pending">pending</option>
              <option value="paid">paid</option>
              <option value="expired">expired</option>
              <option value="canceled">canceled</option>
            </Select>
            <a href={exportHref("csv")} download>
              <Button>CSV</Button>
            </a>
            <a href={exportHref("xlsx")} download>
              <Button>XLSX</Button>
            </a>
          </div>
        }
      />
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-left dark:border-zinc-800 dark:bg-zinc-950/50">
                {COLUMNS.map((c) => (
                  <th key={c.key} className="px-4 py-2.5">
                    <button
                      onClick={() => toggleSort(c.key)}
                      className="inline-flex items-center gap-1 font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
                    >
                      {c.label}
                      <span className="text-xs text-zinc-400">
                        {sort.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  </th>
                ))}
                <th className="px-4 py-2.5 text-right font-semibold text-zinc-600 dark:text-zinc-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((i) => (
                <tr key={i.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40">
                  {COLUMNS.map((c) => (
                    <td key={c.key} className="px-4 py-2.5 align-middle">
                      {c.render(i)}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right">
                    {i.status === "paid" && Number(i.refundedSat ?? "0") < Number(i.amountSat) && (
                      <Button className="px-2 py-1 text-xs" onClick={() => setRefundFor(i)}>
                        Refund
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="px-4 py-8 text-center text-zinc-500">
                    No invoices yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {refundFor && (
        <RefundModal
          invoice={refundFor}
          onClose={() => setRefundFor(null)}
          onDone={() => {
            setRefundFor(null);
            load();
          }}
        />
      )}
    </div>
  );
}
