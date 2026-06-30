import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Button, Card, PageHeader, Spinner } from "../components/ui";

export function Status() {
  const [status, setStatus] = useState<any>(null);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [test, setTest] = useState<Record<string, string>>({});

  useEffect(() => {
    api.status().then(setStatus).catch(() => {});
    api.stats().then(setStats).catch(() => {});
  }, []);

  const runTest = async (which: "phoenixd" | "explorer" | "email") => {
    setTest((t) => ({ ...t, [which]: "testing…" }));
    try {
      const r = await api.test(which);
      setTest((t) => ({ ...t, [which]: (r.ok ? "✅ " : "❌ ") + r.detail }));
    } catch (e) {
      setTest((t) => ({ ...t, [which]: "❌ " + (e as Error).message }));
    }
  };

  const rail = (r: any, settingsPath: string) => (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className={r?.ok ? "text-emerald-600 dark:text-emerald-400" : "text-primary-600 dark:text-primary-500"}>
        {r?.detail}
      </span>
      {r && !r.enabled && (
        <Link to={settingsPath} className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
          Configure →
        </Link>
      )}
    </span>
  );

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Health of your payment rails and invoice totals." />

      <Card className="mb-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <span className="font-semibold text-zinc-800 dark:text-zinc-200">🛡️ Sentinelle</span> is a
          self-hosted Bitcoin invoicing gateway. It turns a price in BTC, EUR or USD into a
          time-boxed invoice payable on two rails at once — <span className="font-medium">on-chain</span>{" "}
          (addresses derived from your watch-only xpub) and{" "}
          <span className="font-medium">Lightning</span> (BOLT11 from your own phoenixd node). Your
          private keys never touch the server.
        </p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Rails</h2>
          {status ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-zinc-500">On-chain</dt>
              <dd>{rail(status.onchain, "/settings/bitcoin")}</dd>
              <dt className="text-zinc-500">Lightning</dt>
              <dd>{rail(status.lightning, "/settings/lightning")}</dd>
              <dt className="text-zinc-500">Recycled</dt>
              <dd>{status.recycled ?? "—"}</dd>
            </dl>
          ) : (
            <Spinner />
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => runTest("phoenixd")}>Test phoenixd</Button>
            <Button onClick={() => runTest("explorer")}>Test explorer</Button>
            <Button onClick={() => runTest("email")}>Test email</Button>
          </div>
          {Object.entries(test).map(([k, v]) => (
            <p key={k} className="mt-2 text-xs text-zinc-500">
              <span className="font-medium">{k}:</span> {v}
            </p>
          ))}
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Invoices</h2>
          {stats ? (
            <div className="grid grid-cols-2 gap-4">
              {Object.entries(stats).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="text-xs uppercase tracking-wide text-zinc-500">{k}</div>
                  <div className="mt-1 text-2xl font-semibold">{v}</div>
                </div>
              ))}
            </div>
          ) : (
            <Spinner />
          )}
        </Card>
      </div>
    </div>
  );
}
