import { useEffect, useMemo, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { api } from "../lib/api";
import { SETTINGS_GROUPS, type FieldDef, type SettingsGroup } from "../lib/settingsSchema";
import { Button, Card, Field, Input, PageHeader, Select, Spinner } from "../components/ui";

export function SettingsGroupPage() {
  const { group: path } = useParams();
  const group = SETTINGS_GROUPS.find((g) => g.path === path);
  if (!group) return <Navigate to={`/settings/${SETTINGS_GROUPS[0].path}`} replace />;
  return <GroupForm key={group.path} group={group} />;
}

function GroupForm({ group }: { group: SettingsGroup }) {
  const [raw, setRaw] = useState<Record<string, any> | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const secretKeys: string[] = useMemo(() => raw?._secretKeys ?? [], [raw]);
  const isSecret = (k: string) => secretKeys.includes(k);

  const load = () =>
    api.settings().then((s) => {
      setRaw(s);
      const v: Record<string, string> = {};
      for (const f of group.fields) {
        v[f.key] = typeof s[f.key] === "boolean" ? String(s[f.key]) : (s[f.key] ?? "").toString();
      }
      setValues(v);
    });
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.path]);

  const save = async () => {
    setMsg("");
    setSaving(true);
    const body: Record<string, string> = {};
    for (const f of group.fields) {
      if (isSecret(f.key)) {
        if (values[f.key]) body[f.key] = values[f.key];
      } else {
        body[f.key] = values[f.key] ?? "";
      }
    }
    try {
      await api.saveSettings(body);
      setMsg("Saved ✓");
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!raw) return <Spinner />;

  return (
    <div>
      <PageHeader title={group.title} subtitle={group.description} />
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          {group.fields.map((f) => (
            <div key={f.key} className={f.help && f.help.length > 80 ? "sm:col-span-2" : ""}>
              <FieldInput
                def={f}
                secret={isSecret(f.key)}
                hasValue={Boolean(raw[f.key])}
                value={values[f.key] ?? ""}
                onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
              />
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-3">
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
          {msg && <span className="text-sm text-zinc-500">{msg}</span>}
        </div>
      </Card>

      {group.tool && <ToolPanel tool={group.tool} values={values} />}
    </div>
  );
}

function FieldInput({
  def,
  secret,
  hasValue,
  value,
  onChange,
}: {
  def: FieldDef;
  secret: boolean;
  hasValue: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  const label = secret ? `${def.label} ${hasValue ? "(set)" : ""}` : def.label;
  if (def.type === "select") {
    return (
      <Field label={label} help={def.help}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          {def.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  if (def.type === "boolean") {
    return (
      <Field label={label} help={def.help}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="false">false</option>
          <option value="true">true</option>
        </Select>
      </Field>
    );
  }
  return (
    <Field label={label} help={def.help}>
      <Input
        type={secret ? "password" : def.type === "number" ? "number" : "text"}
        value={value}
        placeholder={secret ? (hasValue ? "•••• leave blank to keep" : "not set") : def.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function ToolPanel({ tool, values }: { tool: NonNullable<SettingsGroup["tool"]>; values: Record<string, string> }) {
  const [out, setOut] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setOut("Working…");
    try {
      if (tool === "xpub") {
        const r = await api.validateXpub(values["bitcoin_xpub"] ?? "");
        setOut(`✅ ${r.scriptType} · ${r.network} · first address ${r.firstAddress}`);
      } else if (tool === "rates") {
        const r = await api.rates();
        setOut(r.error ? `❌ ${r.error}` : `✅ via ${r.source}: 1 BTC = ${r.eur} EUR / ${r.usd} USD (fetched live)`);
      } else {
        const r = await api.test(tool);
        setOut((r.ok ? "✅ " : "❌ ") + r.detail);
      }
    } catch (e) {
      setOut("❌ " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const labels: Record<string, string> = {
    xpub: "Validate xpub",
    phoenixd: "Test phoenixd connection",
    explorer: "Test explorer",
    email: "Test SMTP connection",
    rates: "Fetch live rates",
  };

  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={run} disabled={busy}>
          {labels[tool]}
        </Button>
        <span className="text-sm text-zinc-500">{out}</span>
      </div>
    </Card>
  );
}
