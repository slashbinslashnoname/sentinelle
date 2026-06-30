import { useState } from "react";

// The conversion is locked at order time, so this CSV is the compliant sales
// record: fiat amount, BTC unit price, rate source, sats, and UTC timestamps.
export function Accounting() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");

  const href = () => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (status) p.set("status", status);
    const qs = p.toString();
    return `/api/admin/export.csv${qs ? `?${qs}` : ""}`;
  };

  return (
    <div>
      <h2>Accounting export</h2>
      <p className="muted">
        Download a CSV of invoices with the fiat↔BTC conversion locked at order time — the record your
        bookkeeping or tax tool needs. Dates accept <code>YYYY-MM-DD</code>.
      </p>
      <div className="card grid">
        <div><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">all</option>
            <option value="paid">paid</option>
            <option value="pending">pending</option>
            <option value="expired">expired</option>
            <option value="canceled">canceled</option>
          </select>
        </div>
      </div>
      <a href={href()} download>
        <button className="primary">Download CSV</button>
      </a>
    </div>
  );
}
