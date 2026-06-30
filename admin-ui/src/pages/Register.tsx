import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

export function Register({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const nav = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (pw.length < 8) return setErr("Password must be at least 8 characters.");
    if (pw !== pw2) return setErr("Passwords do not match.");
    try {
      await api.register(pw);
      onDone();
      nav("/");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="center">
      <h1>🛡️ Sentinelle</h1>
      <p className="muted">No admin exists yet. Choose a password to secure this instance.</p>
      <form onSubmit={submit} className="card">
        <label>Admin password</label>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        <label>Confirm password</label>
        <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        {err && <p className="bad">{err}</p>}
        <div className="row" style={{ marginTop: "0.8rem" }}>
          <button className="primary" type="submit">Register</button>
        </div>
      </form>
    </div>
  );
}
