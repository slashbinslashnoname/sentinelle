# Sentinelle — integration spec for LLMs

You are integrating a shop with **Sentinelle**, a self-hosted Bitcoin invoicing
gateway. This file is everything you need. Follow the **checkout UX rules** at the
bottom exactly — they are opinionated on purpose.

## Concept

- You create an **invoice** with a price in `BTC`, `EUR` or `USD`.
- Sentinelle returns a payment request payable for a limited window (default 15
  min) on two rails: an **on-chain address** (from the merchant's xpub) and a
  **Lightning invoice** (BOLT11). Either may be absent if that rail isn't
  configured.
- For `EUR`/`USD`, the fiat→BTC rate is **fetched live at creation** and **locked**
  into the invoice; it never changes afterwards.
- You learn about payment via **WebSocket** events (preferred) or by polling.

## Auth

- Merchant endpoints require header `x-api-key: <key>` (or `Authorization: Bearer <key>`).
- Create a key in the admin UI → **API keys**. Keep it server-side.

## Base URL

`<BASE>` is wherever Sentinelle runs, e.g. `http://localhost:8080`.

## Create an invoice

`POST <BASE>/api/invoices`  (auth: `x-api-key`)

**Always send `description`** — it is shown to the payer and stored on the
invoice. Use the optional per-invoice controls when you need them:

```json
{
  "amount": "19.99",
  "currency": "EUR",
  "description": "Order #123 — 2× Coffee",
  "externalId": "order-123",
  "timeoutSeconds": 900,
  "confirmations": 1,
  "metadata": { "cartId": "abc" }
}
```

Field reference (request):

| Field | Required | Meaning |
|-------|----------|---------|
| `amount` | ✅ | Decimal string in `currency` units (BTC max 8 decimals). |
| `currency` | ✅ | `"BTC"`, `"EUR"` or `"USD"`. |
| `description` | **use it** | Human label shown to the payer, ≤128 chars. |
| `externalId` | recommended | Your order id; echoed back and in events. |
| `timeoutSeconds` | optional | Payment window for THIS invoice, 60–86400 (overrides the global TTL). |
| `confirmations` | optional | On-chain confirmations required for THIS invoice, 0–100 (0 = accept mempool/0-conf; overrides the server default). |
| `metadata` | optional | Arbitrary JSON. |
| `callbackUrl` | optional | Server-to-server URL notified when paid. |

Response `201`:

```json
{
  "id": "8f3c2b1a-…",
  "status": "pending",
  "createdAt": 1782853200000,
  "expiresAt": 1782854100000,
  "expiresInSeconds": 900,
  "amountSat": "39980",
  "amountBtc": "0.00039980",
  "requiredConfirmations": 1,
  "exchangeRate": { "currency": "EUR", "pricePerBtc": "50000.00", "source": "mempool", "lockedAt": 1782853200000 },
  "onchain": { "address": "bc1q…", "scriptType": "p2wpkh", "index": 0 },
  "lightning": { "invoice": "lnbc…", "paymentHash": "…" }
}
```

`requiredConfirmations` is `null` when the invoice uses the server default.
`exchangeRate` is `null` for a BTC-priced invoice.

> **Do NOT use `bip21`.** Even though a `bip21` field may exist, the required UX
> is **two separate tabs** (On-chain / Lightning), each with **its own QR** built
> from `onchain.address` and `lightning.invoice` respectively. Never show a
> unified QR.

## Other endpoints

- `GET  <BASE>/api/invoices/{id}` (merchant) — full invoice.
- `POST <BASE>/api/invoices/{id}/cancel` (merchant) — cancel a pending invoice.
- `GET  <BASE>/api/public/invoices/{id}` (no auth; the id is the capability) —
  public status: `status`, amounts, `detectedAt`, `paidAt`, `expiresAt`,
  `requiredConfirmations`, destinations. Use this to render checkout & to poll.

## Real-time events (WebSocket)

`ws(s)://<BASE>/ws?invoice=<id>` — JSON frames:

```json
{ "type": "invoice.paid", "invoiceId": "8f3c…", "status": "paid",
  "amountSat": "39980", "externalId": "order-123",
  "detail": { "via": "lightning", "receivedSat": "39980" } }
```

Event types, in order of the retail flow:
- `invoice.payment_detected` — funds seen unconfirmed (mempool) / LN pending. This
  is your cue to swap the QR for a **“Payment detected — confirming…”** state.
- `invoice.paid` — settled. Swap to **“Payment confirmed ✓”** (terminal, success).
- `invoice.expired` — window elapsed unpaid (terminal).
- `invoice.canceled` — canceled by the merchant (terminal).

Server-to-server firehose (all invoices): `ws://<BASE>/ws?key=<api_key>`.

## Checkout UX rules (build it exactly like this)

1. Create the invoice with a real `description`, and set `timeoutSeconds` /
   `confirmations` if the shop needs them.
2. Render **two tabs**: **On-chain** and **Lightning** (only show the tabs whose
   destination exists). Each tab shows **its own QR** — encode `onchain.address`
   in the on-chain tab and `lightning.invoice` (uppercased is fine) in the
   Lightning tab. **Never** use `bip21`.
3. Show a live **countdown timer** to `expiresAt` (mm:ss). When it hits 0, show an
   “expired — start over” state.
4. Open `WebSocket /ws?invoice=<id>`. Also poll `GET /api/public/invoices/<id>`
   every ~5 s as a fallback (proxies sometimes block sockets).
5. On `invoice.payment_detected`, **replace the QR area** with a beautiful
   “Payment detected — confirming (0/N)…” panel (N = `requiredConfirmations`, or
   just a spinner if null/0). On `invoice.paid`, replace it with a “Payment
   confirmed ✓” success panel and stop the timer.
6. Never trust the client alone — confirm `status === "paid"` from your backend
   (public or merchant GET) before fulfilling the order.

## Reference checkout component (React, self-contained)

Uses the `qrcode` package (`npm i qrcode`). Framework-agnostic styling via inline
styles so it drops into any app.

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

type Invoice = {
  id: string; status: string; expiresAt: number;
  amountBtc: string; requiredConfirmations: number | null;
  onchain: { address: string } | null;
  lightning: { invoice: string } | null;
};

function Qr({ data }: { data: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) QRCode.toCanvas(ref.current, data, { width: 240, margin: 1 }); }, [data]);
  return <canvas ref={ref} style={{ borderRadius: 12, background: "#fff", padding: 8 }} />;
}

export function Checkout({ base, invoice }: { base: string; invoice: Invoice }) {
  const rails = useMemo(
    () => [
      invoice.onchain && { key: "onchain", label: "On-chain", data: invoice.onchain.address },
      invoice.lightning && { key: "lightning", label: "Lightning", data: invoice.lightning.invoice.toUpperCase() },
    ].filter(Boolean) as { key: string; label: string; data: string }[],
    [invoice],
  );
  const [tab, setTab] = useState(rails[0]?.key);
  const [phase, setPhase] = useState<"pending" | "detected" | "paid" | "expired">(
    invoice.status === "paid" ? "paid" : "pending",
  );
  const [left, setLeft] = useState(Math.max(0, Math.round((invoice.expiresAt - Date.now()) / 1000)));

  // Countdown.
  useEffect(() => {
    const t = setInterval(() => {
      const s = Math.max(0, Math.round((invoice.expiresAt - Date.now()) / 1000));
      setLeft(s);
      if (s === 0 && phase === "pending") setPhase("expired");
    }, 500);
    return () => clearInterval(t);
  }, [invoice.expiresAt, phase]);

  // Live events (+ polling fallback).
  useEffect(() => {
    const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws?invoice=" + invoice.id);
    ws.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === "invoice.payment_detected" && phase === "pending") setPhase("detected");
      if (ev.type === "invoice.paid") setPhase("paid");
      if (ev.type === "invoice.expired") setPhase("expired");
    };
    const poll = setInterval(async () => {
      const r = await fetch(base + "/api/public/invoices/" + invoice.id);
      if (r.ok) { const i = await r.json();
        if (i.status === "paid") setPhase("paid");
        else if (i.detectedAt) setPhase((p) => (p === "pending" ? "detected" : p)); }
    }, 5000);
    return () => { ws.close(); clearInterval(poll); };
  }, [base, invoice.id, phase]);

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  const N = invoice.requiredConfirmations ?? 0;

  return (
    <div style={{ width: 320, fontFamily: "system-ui", border: "1px solid #8883", borderRadius: 16, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong style={{ fontSize: 20 }}>{invoice.amountBtc} BTC</strong>
        <span style={{ opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>⏳ {mm}:{ss}</span>
      </div>

      {phase === "pending" && (
        <>
          <div style={{ display: "flex", gap: 8, margin: "14px 0" }}>
            {rails.map((r) => (
              <button key={r.key} onClick={() => setTab(r.key)}
                style={{ flex: 1, padding: "8px 0", borderRadius: 10, cursor: "pointer",
                  border: "1px solid #8884", background: tab === r.key ? "#dc2626" : "transparent",
                  color: tab === r.key ? "#fff" : "inherit", fontWeight: 600 }}>
                {r.label}
              </button>
            ))}
          </div>
          <div style={{ display: "grid", placeItems: "center" }}>
            <Qr data={rails.find((r) => r.key === tab)!.data} />
          </div>
          <p style={{ fontSize: 11, wordBreak: "break-all", opacity: 0.7, marginTop: 10 }}>
            {rails.find((r) => r.key === tab)!.data}
          </p>
        </>
      )}

      {/* The QR is REPLACED by these states — this is the required UX. */}
      {phase === "detected" && (
        <Center>
          <Ring color="#f59e0b" spin />
          <b>Payment detected</b>
          <small style={{ opacity: 0.7 }}>{N > 0 ? `Confirming (0/${N})…` : "Confirming…"}</small>
        </Center>
      )}
      {phase === "paid" && (
        <Center>
          <Ring color="#16a34a" check />
          <b style={{ color: "#16a34a" }}>Payment confirmed</b>
          <small style={{ opacity: 0.7 }}>Thank you!</small>
        </Center>
      )}
      {phase === "expired" && (
        <Center>
          <Ring color="#dc2626" />
          <b style={{ color: "#dc2626" }}>Invoice expired</b>
          <small style={{ opacity: 0.7 }}>Start a new payment.</small>
        </Center>
      )}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", placeItems: "center", gap: 8, height: 260 }}>{children}</div>;
}
function Ring({ color, spin, check }: { color: string; spin?: boolean; check?: boolean }) {
  return (
    <div style={{ width: 72, height: 72, borderRadius: "50%", display: "grid", placeItems: "center",
      border: `4px solid ${color}`, borderTopColor: spin ? "transparent" : color,
      animation: spin ? "spin 1s linear infinite" : undefined, fontSize: 30, color }}>
      {check ? "✓" : ""}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
```

## Rules of thumb

- Amounts are **strings** (bigint-safe). Don't do float math on them.
- One invoice = one payment attempt. To retry after expiry, create a new invoice.
- `externalId` is your join key back to your order; it's echoed in events.
- Currency `"BTC"`: `amount` is exact BTC (≤8 decimals), no rate, `exchangeRate` null.
