// Thin API client. All admin calls ride the session cookie (same-origin).

export interface AdminState {
  registered: boolean;
  authenticated: boolean;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) detail = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("application/json") ? await res.json() : await res.text()) as T;
}

export const api = {
  state: () => req<AdminState>("/api/admin/state"),
  register: (password: string) =>
    req("/api/admin/register", { method: "POST", body: JSON.stringify({ password }) }),
  login: (password: string) =>
    req("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => req("/api/admin/logout", { method: "POST" }),

  status: () => req<any>("/api/admin/status"),
  stats: () => req<Record<string, number>>("/api/admin/stats"),
  settings: () => req<Record<string, any>>("/api/admin/settings"),
  saveSettings: (body: Record<string, string>) =>
    req<{ changed: string[]; settings: Record<string, any> }>("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  test: (which: "phoenixd" | "explorer" | "email") =>
    req<{ ok: boolean; detail: string }>(`/api/admin/test/${which}`, { method: "POST" }),
  rates: () => req<{ source: string; eur: string | null; usd: string | null; error?: string }>("/api/admin/rates"),
  validateXpub: (xpub: string) =>
    req<any>("/api/admin/validate-xpub", { method: "POST", body: JSON.stringify({ xpub }) }),

  keys: () => req<ApiKeyInfo[]>("/api/admin/keys"),
  createKey: (label: string) =>
    req<{ key: string; info: ApiKeyInfo }>("/api/admin/keys", {
      method: "POST",
      body: JSON.stringify({ label }),
    }),
  revokeKey: (id: number) => req(`/api/admin/keys/${id}`, { method: "DELETE" }),

  invoices: (status?: string) =>
    req<InvoiceView[]>(`/api/admin/invoices${status ? `?status=${status}` : ""}`),
  refund: (id: string, body: { amountSat: number; reference?: string; note?: string }) =>
    req<{ invoice: InvoiceView; refund: any }>(`/api/admin/invoices/${id}/refunds`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  refunds: (id: string) => req<RefundView[]>(`/api/admin/invoices/${id}/refunds`),
};

export interface RefundView {
  id: number;
  amountSat: string;
  amountBtc: string;
  reference: string | null;
  note: string | null;
  createdAt: number;
}

export interface ApiKeyInfo {
  id: number;
  label: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface InvoiceView {
  id: string;
  status: string;
  createdAt: number;
  amountSat: string;
  amountBtc: string;
  price: { currency: string; minor: string };
  rateSource: string | null;
  refundedSat?: string;
}
