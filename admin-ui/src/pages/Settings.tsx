import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

export function Settings() {
  const [settings, setSettings] = useState<Record<string, any> | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [xpubCheck, setXpubCheck] = useState("");

  const secretKeys: string[] = useMemo(() => settings?._secretKeys ?? [], [settings]);
  const keys = useMemo(
    () => (settings ? Object.keys(settings).filter((k) => !k.startsWith("_")) : []),
    [settings],
  );

  const load = () =>
    api.settings().then((s) => {
      setSettings(s);
      const v: Record<string, string> = {};
      for (const k of Object.keys(s)) {
        if (k.startsWith("_")) continue;
        v[k] = typeof s[k] === "boolean" ? String(s[k]) : (s[k] ?? "").toString();
      }
      setValues(v);
    });
  useEffect(() => {
    load();
  }, []);

  const isSecret = (k: string) => secretKeys.includes(k);

  const save = async () => {
    setMsg("");
    const body: Record<string, string> = {};
    for (const k of keys) {
      if (isSecret(k)) {
        if (values[k] && values[k].length > 0) body[k] = values[k];
      } else {
        body[k] = values[k] ?? "";
      }
    }
    try {
      await api.saveSettings(body);
      setMsg("Saved ✓");
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const checkXpub = async () => {
    setXpubCheck("checking…");
    try {
      const r = await api.validateXpub(values["bitcoin_xpub"] ?? "");
      setXpubCheck(`✅ ${r.scriptType} · ${r.network} · first ${r.firstAddress}`);
    } catch (e) {
      setXpubCheck("❌ " + (e as Error).message);
    }
  };

  if (!settings) return <p className="muted">Loading…</p>;

  return (
    <div>
      <h2>Operational settings</h2>
      <p className="muted">
        Stored in the database, applied live. Secrets are write-only — leave blank to keep the current value.
      </p>
      <div className="card grid">
        {keys.map((k) => (
          <div key={k}>
            <label>
              {k} {isSecret(k) && <span className="muted">(secret{settings[k] ? ", set" : ""})</span>}
            </label>
            <input
              type={isSecret(k) ? "password" : "text"}
              value={isSecret(k) ? values[k] ?? "" : values[k] ?? ""}
              placeholder={isSecret(k) ? (settings[k] ? "•••• leave blank to keep" : "not set") : ""}
              onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
            />
            {k === "bitcoin_xpub" && (
              <div className="row" style={{ marginTop: "0.3rem" }}>
                <button onClick={checkXpub}>Validate xpub</button>
                <span className="muted">{xpubCheck}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="row">
        <button className="primary" onClick={save}>Save settings</button>
        <span className="muted">{msg}</span>
      </div>
    </div>
  );
}
