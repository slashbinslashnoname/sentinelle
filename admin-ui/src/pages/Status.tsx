import { useEffect, useState } from "react";
import { api } from "../lib/api";

export function Status() {
  const [status, setStatus] = useState<any>(null);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [test, setTest] = useState<Record<string, string>>({});

  const load = () => {
    api.status().then(setStatus).catch(() => {});
    api.stats().then(setStats).catch(() => {});
  };
  useEffect(load, []);

  const runTest = async (which: "phoenixd" | "explorer" | "email") => {
    setTest((t) => ({ ...t, [which]: "testing…" }));
    try {
      const r = await api.test(which);
      setTest((t) => ({ ...t, [which]: (r.ok ? "✅ " : "❌ ") + r.detail }));
    } catch (e) {
      setTest((t) => ({ ...t, [which]: "❌ " + (e as Error).message }));
    }
  };

  return (
    <div>
      <h2>Rails</h2>
      <div className="card">
        {status ? (
          <div className="grid">
            <div>On-chain</div>
            <div className={status.onchain.ok ? "ok" : "bad"}>{status.onchain.detail}</div>
            <div>Lightning</div>
            <div className={status.lightning.ok ? "ok" : "bad"}>{status.lightning.detail}</div>
            <div>Next address index</div>
            <div>{status.nextIndex ?? "—"}</div>
            <div>Recycled indices</div>
            <div>{status.recycled ?? "—"}</div>
          </div>
        ) : (
          <span className="muted">Loading…</span>
        )}
        <div className="row" style={{ marginTop: "0.8rem" }}>
          <button onClick={() => runTest("phoenixd")}>Test phoenixd</button>
          <button onClick={() => runTest("explorer")}>Test explorer</button>
          <button onClick={() => runTest("email")}>Test email</button>
        </div>
        {Object.entries(test).map(([k, v]) => (
          <p key={k} className="muted" style={{ margin: "0.3rem 0" }}>
            <b>{k}:</b> {v}
          </p>
        ))}
      </div>

      <h2>Invoices</h2>
      <div className="card row" style={{ gap: "1.5rem" }}>
        {stats ? (
          Object.entries(stats).map(([k, v]) => (
            <div key={k}>
              <div className="muted">{k}</div>
              <div style={{ fontSize: "1.4rem", fontWeight: 700 }}>{v}</div>
            </div>
          ))
        ) : (
          <span className="muted">Loading…</span>
        )}
      </div>
    </div>
  );
}
