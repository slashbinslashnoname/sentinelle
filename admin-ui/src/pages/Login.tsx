import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

export function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const nav = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    try {
      await api.login(pw);
      onDone();
      nav("/");
    } catch {
      setErr("Invalid password.");
    }
  };

  return (
    <div className="center">
      <h1>🛡️ Sentinelle</h1>
      <p className="muted">Enter your admin password.</p>
      <form onSubmit={submit} className="card">
        <label>Admin password</label>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        {err && <p className="bad">{err}</p>}
        <div className="row" style={{ marginTop: "0.8rem" }}>
          <button className="primary" type="submit">Login</button>
        </div>
      </form>
    </div>
  );
}
