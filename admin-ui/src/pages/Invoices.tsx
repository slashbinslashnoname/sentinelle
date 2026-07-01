import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type InvoiceView } from "../lib/api";
import { Badge, Button, Card, Input, PageHeader, Select } from "../components/ui";
import { RefundModal } from "../components/RefundModal";

type SortKey = "id" | "externalId" | "status" | "amountSat" | "price" | "createdAt";
type Dir = "asc" | "desc";

const fmtTs = (ts: number | null | undefined) =>
  ts == null ? "—" : new Date(ts).toISOString().slice(0, 16).replace("T", " ");

const satToBtc = (sat: string | null | undefined) =>
  sat == null ? "—" : (Number(sat) / 1e8).toFixed(8);

/**
 * Status as shown to the operator: a paid invoice with a recorded refund reads
 * as "refunded" (or "part refunded" for a partial), and a pending invoice whose
 * funds are already seen reads as "detected".
 */
const displayStatus = (i: InvoiceView) => {
  if (i.status === "paid" && Number(i.refundedSat ?? "0") > 0) {
    return Number(i.refundedSat) >= Number(i.amountSat) ? "refunded" : "part refunded";
  }
  if (i.status === "pending" && i.detectedAt != null) return "detected";
  return i.status;
};

interface Column {
  key: SortKey;
  label: string;
  numeric?: boolean;
  hideSm?: boolean; // hidden on the smallest screens to stay responsive
  value: (i: InvoiceView) => string | number;
  render: (i: InvoiceView) => React.ReactNode;
}

const COLUMNS: Column[] = [
  { key: "id", label: "ID", value: (i) => i.id, render: (i) => <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">{i.id.slice(0, 8)}</code> },
  {
    key: "externalId",
    label: "External ID",
    value: (i) => i.externalId ?? "",
    render: (i) => (i.externalId ? <span className="text-xs">{i.externalId}</span> : <span className="text-zinc-400">—</span>),
  },
  { key: "status", label: "Status", value: (i) => displayStatus(i), render: (i) => <Badge status={displayStatus(i)} /> },
  { key: "amountSat", label: "Amount", numeric: true, value: (i) => Number(i.amountSat), render: (i) => `${i.amountBtc} BTC` },
  {
    key: "price",
    label: "Price",
    numeric: true,
    hideSm: true,
    value: (i) => (i.price.currency === "BTC" ? Number(i.amountSat) : Number(i.price.minor)),
    render: (i) => (i.price.currency === "BTC" ? "—" : `${(Number(i.price.minor) / 100).toFixed(2)} ${i.price.currency}`),
  },
  { key: "createdAt", label: "Created", numeric: true, hideSm: true, value: (i) => i.createdAt, render: (i) => fmtTs(i.createdAt) },
];

function Copy({ value }: { value?: string | null }) {
  const [done, setDone] = useState(false);
  if (!value) return null;
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="shrink-0 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
    >
      {done ? "✓" : "copy"}
    </button>
  );
}

function Field({ label, value, copy }: { label: string; value?: React.ReactNode; copy?: string | null }) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="flex min-w-0 items-start gap-2">
        <span className="min-w-0 break-all">{value ?? <span className="text-zinc-400">—</span>}</span>
        {copy != null && copy !== "" && <Copy value={copy} />}
      </dd>
    </>
  );
}

function DescriptionEditor({ i, onSaved }: { i: InvoiceView; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(i.description ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setVal(i.description ?? "");
    setEditing(false);
  }, [i.id]);

  if (!editing) {
    return (
      <span className="flex items-start gap-2">
        <span className="min-w-0 break-words">{i.description || <span className="text-zinc-400">—</span>}</span>
        <button
          onClick={() => setEditing(true)}
          className="shrink-0 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          edit
        </button>
      </span>
    );
  }
  const save = async () => {
    setBusy(true);
    try {
      await api.updateInvoiceDescription(i.id, val);
      onSaved();
      setEditing(false);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex flex-col gap-1.5">
      <Input value={val} maxLength={128} onChange={(e) => setVal(e.target.value)} autoFocus />
      <span className="flex gap-2">
        <Button variant="primary" className="px-2 py-1 text-xs" onClick={save} disabled={busy}>
          Save
        </Button>
        <Button className="px-2 py-1 text-xs" onClick={() => { setEditing(false); setVal(i.description ?? ""); }}>
          Cancel
        </Button>
      </span>
    </span>
  );
}

function InvoiceDetails({ i, onSaved }: { i: InvoiceView; onSaved: () => void }) {
  const mono = "font-mono text-xs";
  return (
    <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2.5 px-4 py-4 text-sm">
      <Field label="Invoice ID" value={<span className={mono}>{i.id}</span>} copy={i.id} />
      <Field label="External ID" value={i.externalId ? <span className={mono}>{i.externalId}</span> : undefined} copy={i.externalId} />
      <Field label="Status" value={<Badge status={displayStatus(i)} />} />
      <Field label="Amount" value={`${i.amountBtc} BTC (${i.amountSat} sat)`} copy={i.amountSat} />
      <Field
        label="Price"
        value={i.price.currency === "BTC" ? `${i.amountBtc} BTC` : `${(Number(i.price.minor) / 100).toFixed(2)} ${i.price.currency}`}
      />
      <Field label="Rate" value={i.rateMinor != null ? `${(Number(i.rateMinor) / 100).toFixed(2)} ${i.price.currency}/BTC · ${i.rateSource ?? "—"}` : (i.rateSource ?? undefined)} />
      <dt className="text-zinc-500">Description</dt>
      <dd className="min-w-0"><DescriptionEditor i={i} onSaved={onSaved} /></dd>

      <Field label="Created" value={fmtTs(i.createdAt)} />
      <Field label="Expires" value={fmtTs(i.expiresAt)} />
      <Field label="Detected" value={fmtTs(i.detectedAt)} />
      <Field label="Paid" value={fmtTs(i.paidAt)} />

      <Field label="On-chain" value={i.onchain ? <span className={mono}>{i.onchain.address}</span> : undefined} copy={i.onchain?.address} />
      {i.onchain && <Field label="Address path" value={`${i.onchain.scriptType ?? "—"} · chain ${i.onchain.chain ?? "—"} · index ${i.onchain.index ?? "—"}`} />}
      <Field label="Lightning" value={i.lightning ? <span className={mono}>{i.lightning.invoice}</span> : undefined} copy={i.lightning?.invoice} />
      {i.lightning?.paymentHash && <Field label="Payment hash" value={<span className={mono}>{i.lightning.paymentHash}</span>} copy={i.lightning.paymentHash} />}
      <Field label="BIP21" value={i.bip21 ? <span className={mono}>{i.bip21}</span> : undefined} copy={i.bip21} />

      {i.paidVia && (
        <Field
          label="Paid on"
          value={
            <span className="font-medium">
              {i.paidVia === "onchain" ? "⛓️ On-chain" : i.paidVia === "lightning" ? "⚡ Lightning" : i.paidVia}
            </span>
          }
        />
      )}
      {i.paidAmountSat && <Field label="Received" value={`${satToBtc(i.paidAmountSat)} BTC`} />}
      {i.paidReference && (
        <Field
          label={i.paidVia === "lightning" ? "Payment hash" : "Paid to"}
          value={<span className={mono}>{i.paidReference}</span>}
          copy={i.paidReference}
        />
      )}
      {Number(i.refundedSat ?? "0") > 0 && <Field label="Refunded" value={`${satToBtc(i.refundedSat)} BTC`} />}
      {i.callbackUrl && <Field label="Callback" value={<span className={mono}>{i.callbackUrl}</span>} copy={i.callbackUrl} />}
      {i.metadata && Object.keys(i.metadata).length > 0 && (
        <Field label="Metadata" value={<span className={mono}>{JSON.stringify(i.metadata)}</span>} copy={JSON.stringify(i.metadata)} />
      )}
    </dl>
  );
}

/** Right-hand slide-over drawer; full-width on mobile, fixed width on desktop. */
function Drawer({ open, onClose, title, actions, children }: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`fixed inset-0 z-40 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
      />
      <aside
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-200 dark:bg-zinc-900 ${open ? "translate-x-0" : "translate-x-full"}`}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
          >
            ✕
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {actions && (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
            {actions}
          </footer>
        )}
      </aside>
    </div>
  );
}

export function Invoices() {
  const [list, setList] = useState<InvoiceView[]>([]);
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: "createdAt", dir: "desc" });
  const [refundFor, setRefundFor] = useState<InvoiceView | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const load = useCallback(
    () => api.invoices(status || undefined).then(setList).catch(() => {}),
    [status],
  );
  useEffect(() => {
    load();
  }, [load]);

  // Live refresh: one admin WebSocket streams every invoice event; on any of
  // them we refetch (coalesced), so the list — and the open drawer — stay current.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    let debounce: ReturnType<typeof setTimeout>;
    const scheduleReload = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => loadRef.current(), 250);
    };
    const connect = () => {
      ws = new WebSocket(window.location.origin.replace(/^http/, "ws") + "/ws");
      ws.onopen = () => setLive(true);
      ws.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          if (typeof ev.type === "string" && ev.type.startsWith("invoice.")) scheduleReload();
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        setLive(false);
        if (!closed) retry = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      clearTimeout(debounce);
      ws?.close();
    };
  }, []);

  const cancel = async (i: InvoiceView) => {
    if (!confirm("Cancel this pending invoice? Its address/index is freed for reuse.")) return;
    try {
      await api.cancelInvoice(i.id);
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  };

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

  // Look the detail invoice up in the live list so the drawer refreshes too.
  const detail = detailId ? list.find((x) => x.id === detailId) ?? null : null;
  const detailRefundable = detail?.status === "paid" && Number(detail.refundedSat ?? "0") < Number(detail.amountSat);
  const colCount = COLUMNS.length + 1;

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="Open Details for the address, Lightning invoice and metadata. Updates live."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 text-xs ${live ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400"}`}
              title={live ? "Live — refreshing on payment events" : "Reconnecting…"}
            >
              <span className={`h-2 w-2 rounded-full ${live ? "bg-emerald-500" : "bg-zinc-400"}`} />
              {live ? "live" : "offline"}
            </span>
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
                  <th key={c.key} className={`px-4 py-2.5 ${c.hideSm ? "hidden sm:table-cell" : ""}`}>
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
              {sorted.map((i) => {
                const refundable = i.status === "paid" && Number(i.refundedSat ?? "0") < Number(i.amountSat);
                return (
                  <tr
                    key={i.id}
                    className={`cursor-pointer border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40 ${detailId === i.id ? "bg-zinc-50 dark:bg-zinc-800/40" : ""}`}
                    onClick={() => setDetailId(i.id)}
                  >
                    {COLUMNS.map((c) => (
                      <td key={c.key} className={`px-4 py-2.5 align-middle ${c.hideSm ? "hidden sm:table-cell" : ""}`}>
                        {c.render(i)}
                      </td>
                    ))}
                    <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        <Button className="px-2 py-1 text-xs" onClick={() => setDetailId(i.id)}>
                          Details
                        </Button>
                        {i.status === "pending" && (
                          <Button variant="danger" className="hidden px-2 py-1 text-xs sm:inline-flex" onClick={() => cancel(i)}>
                            Cancel
                          </Button>
                        )}
                        {refundable && (
                          <Button className="hidden px-2 py-1 text-xs sm:inline-flex" onClick={() => setRefundFor(i)}>
                            Refund
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="px-4 py-8 text-center text-zinc-500">
                    No invoices yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Drawer
        open={detail !== null}
        onClose={() => setDetailId(null)}
        title={detail ? <span className="font-mono">{detail.id.slice(0, 12)}…</span> : ""}
        actions={
          detail && (
            <>
              {detail.status === "pending" && (
                <Button variant="danger" className="text-xs" onClick={() => cancel(detail)}>
                  Cancel invoice
                </Button>
              )}
              {detailRefundable && (
                <Button className="text-xs" onClick={() => setRefundFor(detail)}>
                  Refund
                </Button>
              )}
            </>
          )
        }
      >
        {detail && <InvoiceDetails i={detail} onSaved={load} />}
      </Drawer>

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
