import { useEffect, useState } from "react";
import { api, type InvoiceView, type RefundView } from "../lib/api";
import { Button, Field, Input } from "./ui";

// Records a reimbursement against a paid invoice (partial refunds allowed).
export function RefundModal({
  invoice,
  onClose,
  onDone,
}: {
  invoice: InvoiceView;
  onClose: () => void;
  onDone: () => void;
}) {
  const received = Number(invoice.amountSat);
  const alreadyRefunded = Number(invoice.refundedSat ?? "0");
  const remaining = received - alreadyRefunded;

  const [amount, setAmount] = useState(String(remaining));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<RefundView[]>([]);

  useEffect(() => {
    api.refunds(invoice.id).then(setHistory).catch(() => {});
  }, [invoice.id]);

  const submit = async () => {
    setErr("");
    const amountSat = Math.trunc(Number(amount));
    if (!Number.isFinite(amountSat) || amountSat <= 0) return setErr("Enter a positive sat amount.");
    if (amountSat > remaining) return setErr(`At most ${remaining} sat can still be refunded.`);
    setBusy(true);
    try {
      await api.refund(invoice.id, { amountSat, reference: reference || undefined, note: note || undefined });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-lg font-semibold">Record reimbursement</h3>
        <p className="mt-1 text-sm text-zinc-500">
          Invoice <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">{invoice.id.slice(0, 8)}</code> ·
          received {invoice.amountBtc} BTC · already refunded {(alreadyRefunded / 1e8).toFixed(8)} BTC
        </p>

        <div className="mt-4 space-y-3">
          <Field label="Amount (sats)" help={`Up to ${remaining} sat remaining.`}>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Reference" help="e.g. on-chain txid or LN payment id of the refund.">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Note">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {err && <p className="text-sm text-primary-600">{err}</p>}
        </div>

        {history.length > 0 && (
          <div className="mt-4 rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800">
            <div className="mb-1 font-medium text-zinc-500">History</div>
            {history.map((r) => (
              <div key={r.id} className="flex justify-between py-0.5">
                <span>{r.amountBtc} BTC{r.reference ? ` · ${r.reference}` : ""}</span>
                <span className="text-zinc-400">{new Date(r.createdAt).toISOString().slice(0, 10)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy || remaining <= 0}>
            {busy ? "Saving…" : "Record refund"}
          </Button>
        </div>
      </div>
    </div>
  );
}
