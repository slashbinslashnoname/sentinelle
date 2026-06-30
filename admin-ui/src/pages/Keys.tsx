import { useEffect, useState } from "react";
import { api, type ApiKeyInfo } from "../lib/api";

export function Keys() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);

  const load = () => api.keys().then(setKeys).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    const r = await api.createKey(label || "unnamed");
    setFresh(r.key);
    setLabel("");
    load();
  };
  const revoke = async (id: number) => {
    if (!confirm("Revoke this key? Apps using it will stop working.")) return;
    await api.revokeKey(id);
    load();
  };

  return (
    <div>
      <h2>Merchant API keys</h2>
      <p className="muted">Your shop sends a key as <code>x-api-key</code> to create invoices. Create one per integration; revoke anytime.</p>
      <div className="card">
        <div className="row">
          <input placeholder="label (e.g. my-shop)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: 1 }} />
          <button className="primary" onClick={create}>Create key</button>
        </div>
        {fresh && (
          <div className="card copywrap" style={{ marginTop: "0.7rem" }}>
            <b>Copy now — shown once:</b>
            <pre>{fresh}</pre>
            <button onClick={() => navigator.clipboard.writeText(fresh)}>copy</button>
          </div>
        )}
        <table style={{ marginTop: "0.8rem" }}>
          <thead>
            <tr><th>Label</th><th>Prefix</th><th>Created</th><th>Last used</th><th></th></tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.label}</td>
                <td><code>{k.prefix}…</code></td>
                <td>{fmt(k.createdAt)}</td>
                <td>{k.lastUsedAt ? fmt(k.lastUsedAt) : "—"}</td>
                <td>{k.revokedAt ? <span className="bad">revoked</span> : <button onClick={() => revoke(k.id)}>revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmt(ms: number) {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}
