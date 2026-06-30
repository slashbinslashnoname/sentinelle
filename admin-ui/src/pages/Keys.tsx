import { useEffect, useState } from "react";
import { api, type ApiKeyInfo } from "../lib/api";
import { Button, Card, CopyBlock, Input, PageHeader } from "../components/ui";

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
  const remove = async (id: number) => {
    if (!confirm("Permanently delete this key? Apps using it will stop working. This cannot be undone."))
      return;
    await api.deleteKey(id);
    load();
  };

  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

  return (
    <div>
      <PageHeader
        title="API keys"
        subtitle="Your shop sends a key as the x-api-key header to create invoices. Create one per integration; delete anytime."
      />
      <Card>
        <div className="flex gap-2">
          <Input placeholder="Label (e.g. my-shop)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Button variant="primary" onClick={create} className="shrink-0">
            Create key
          </Button>
        </div>
        {fresh && (
          <div className="mt-4">
            <p className="mb-1 text-sm font-medium">Copy now — shown once:</p>
            <CopyBlock text={fresh} />
          </div>
        )}
      </Card>

      <Card className="mt-4 overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-left dark:border-zinc-800 dark:bg-zinc-950/50">
                <th className="px-4 py-2.5 font-semibold">Label</th>
                <th className="px-4 py-2.5 font-semibold">Prefix</th>
                <th className="px-4 py-2.5 font-semibold">Created</th>
                <th className="px-4 py-2.5 font-semibold">Last used</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="px-4 py-2.5">{k.label}</td>
                  <td className="px-4 py-2.5">
                    <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">{k.prefix}…</code>
                  </td>
                  <td className="px-4 py-2.5">{fmt(k.createdAt)}</td>
                  <td className="px-4 py-2.5">{k.lastUsedAt ? fmt(k.lastUsedAt) : "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button variant="danger" className="px-2 py-1 text-xs" onClick={() => remove(k.id)}>
                      delete
                    </Button>
                  </td>
                </tr>
              ))}
              {keys.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                    No keys yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
