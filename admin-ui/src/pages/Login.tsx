import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { AuthShell } from "../components/AuthShell";

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30";

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
    <AuthShell subtitle="Welcome back — sign in to manage your gateway.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="text-sm font-medium text-zinc-700">Admin password</label>
          <input className={`mt-1 ${inputCls}`} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </div>
        {err && <p className="text-sm text-primary-600">{err}</p>}
        <button
          type="submit"
          className="w-full rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
        >
          Login
        </button>
      </form>
    </AuthShell>
  );
}
