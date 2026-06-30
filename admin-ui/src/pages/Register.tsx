import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { AuthShell } from "../components/AuthShell";

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30";

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
    <AuthShell subtitle="No admin exists yet — choose a password to secure this instance.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="text-sm font-medium text-zinc-700">Admin password</label>
          <input className={`mt-1 ${inputCls}`} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="text-sm font-medium text-zinc-700">Confirm password</label>
          <input className={`mt-1 ${inputCls}`} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        {err && <p className="text-sm text-primary-600">{err}</p>}
        <button
          type="submit"
          className="w-full rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
        >
          Register
        </button>
      </form>
    </AuthShell>
  );
}
