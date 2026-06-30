import { useEffect, useState } from "react";
import { api, type InvoiceView } from "../lib/api";

export function Invoices() {
  const [list, setList] = useState<InvoiceView[]>([]);
  const [status, setStatus] = useState("");

  const load = () => api.invoices(status || undefined).then(setList).catch(() => {});
  useEffect(() => {
    load();
  }, [status]);

  return (
    <div>
      <h2>Invoices</h2>
      <div className="row">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">all</option>
          <option value="pending">pending</option>
          <option value="paid">paid</option>
          <option value="expired">expired</option>
          <option value="canceled">canceled</option>
        </select>
        <button onClick={load}>Refresh</button>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr><th>id</th><th>status</th><th>amount</th><th>price</th><th>rate src</th><th>created</th></tr>
          </thead>
          <tbody>
            {list.map((i) => (
              <tr key={i.id}>
                <td><code>{i.id.slice(0, 8)}</code></td>
                <td><span className={`badge ${i.status}`}>{i.status}</span></td>
                <td>{i.amountBtc} BTC</td>
                <td>{i.price.currency === "BTC" ? "—" : `${(Number(i.price.minor) / 100).toFixed(2)} ${i.price.currency}`}</td>
                <td>{i.rateSource ?? "—"}</td>
                <td>{new Date(i.createdAt).toISOString().slice(0, 16).replace("T", " ")}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={6} className="muted">No invoices.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
