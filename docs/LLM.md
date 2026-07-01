# Sentinelle — integration spec for LLMs

You are integrating a shop with **Sentinelle**, a self-hosted Bitcoin invoicing
gateway. This file is everything you need.

## Concept

- You create an **invoice** with a price in `BTC`, `EUR` or `USD`.
- Sentinelle returns a Bitcoin payment request payable for ~15 minutes on two
  rails: an **on-chain address** (from the merchant's xpub) and a **Lightning
  invoice** (BOLT11). Either may be absent if that rail isn't configured.
- The fiat→BTC amount is **locked at creation** and never changes.
- You learn about payment via **WebSocket** events or by polling status.

## Auth

- Merchant endpoints require header `x-api-key: <key>` (or `Authorization: Bearer <key>`).
- Keys are created in the admin UI. Treat the key as a secret; keep it server-side.

## Base URL

`<BASE>` is wherever Sentinelle runs, e.g. `http://localhost:8080`.

## Endpoints you use

### Create invoice
`POST <BASE>/api/invoices`  (auth: `x-api-key`)

Request body:
```json
{
  "amount": "19.99",          // decimal string in `currency` units
  "currency": "EUR",          // "BTC" | "EUR" | "USD"
  "description": "Order #123", // optional, ≤128 chars
  "externalId": "order-123",   // optional, your order reference
  "metadata": { "any": "json" },// optional
  "callbackUrl": "https://…"   // optional
}
```

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
  "price": { "currency": "EUR", "minor": "1999" },
  "rateMinor": "5000000",
  "rateSource": "mempool",
  "exchangeRate": {
    "currency": "EUR",
    "pricePerBtc": "50000.00",
    "minor": "5000000",
    "source": "mempool",
    "lockedAt": 1782853200000
  },
  "onchain": { "address": "bc1q…", "scriptType": "p2wpkh", "index": 0, "chain": 0 },
  "lightning": { "invoice": "lnbc…", "paymentHash": "…" },
  "bip21": "bitcoin:bc1q…?amount=0.00039980&lightning=LNBC…"
}
```

`exchangeRate` is the fiat↔BTC rate **locked in at creation time** and used to
compute `amountSat` — `pricePerBtc` is the human-readable price of 1 BTC in the
invoice's currency (`minor` is the raw minor-unit form, same as `rateMinor`).
It is `null` for a BTC-priced invoice (no conversion). This is the compliant
record of the conversion for accounting.

Render `bip21` as a QR for the customer (works for both rails), or show
`onchain.address` and/or `lightning.invoice` separately.

Errors: `400` invalid input, `401` bad/missing key, `503` no rail configured,
`400` with `code:"rate_unavailable"` if the fiat rate couldn't be fetched.

### Get invoice (full, merchant)
`GET <BASE>/api/invoices/{id}`  (auth: `x-api-key`)

### Cancel invoice (merchant)
`POST <BASE>/api/invoices/{id}/cancel`  (auth: `x-api-key`) → `409` if not pending.

### Public status (no auth; id is the capability)
`GET <BASE>/api/public/invoices/{id}` → public view with `status`, amounts,
`detectedAt`, `paidAt`, destinations, `bip21`. No merchant-private fields.

### WebSocket events
`ws(s)://<BASE>/ws?invoice=<id>` — frames are JSON:
```json
{ "type": "invoice.paid", "invoiceId": "8f3c…", "status": "paid",
  "amountSat": "39980", "externalId": "order-123",
  "detail": { "via": "lightning", "receivedSat": "39980", "reference": "…" } }
```
Event types:
- `invoice.payment_detected` — funds seen unconfirmed (mempool / LN pending)
- `invoice.paid` — settled (terminal, success)
- `invoice.expired` — window elapsed unpaid (terminal)
- `invoice.canceled` — canceled by merchant (terminal)

All-events firehose (server-side only): `ws://<BASE>/ws?key=<api_key>`.

## Recommended checkout flow

1. `POST /api/invoices` with the cart total and your order id as `externalId`.
2. Show `bip21` as a QR + copyable `onchain.address` and `lightning.invoice`.
3. Open `WebSocket /ws?invoice=<id>`; on `invoice.paid`, mark the order paid and
   stop. On `invoice.expired`, offer to retry (creates a new invoice).
4. As a fallback, also poll `GET /api/public/invoices/<id>` every few seconds in
   case the socket is blocked by a proxy.
5. Never trust the client alone — confirm `status === "paid"` from your backend
   (the public GET or the merchant GET) before fulfilling.

## Minimal client (TypeScript)

```ts
const BASE = "http://localhost:8080";
const KEY = process.env.SENTINELLE_KEY!;

export async function createInvoice(amount: string, currency: "BTC"|"EUR"|"USD", orderId: string) {
  const r = await fetch(`${BASE}/api/invoices`, {
    method: "POST",
    headers: { "x-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify({ amount, currency, externalId: orderId }),
  });
  if (!r.ok) throw new Error(`create failed: ${r.status}`);
  return r.json();
}

export function onPaid(invoiceId: string, cb: () => void) {
  const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/ws?invoice=${invoiceId}`);
  ws.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === "invoice.paid") { cb(); ws.close(); }
  };
  return () => ws.close();
}
```

## Rules of thumb

- Amounts are **strings** (bigint-safe). Don't parse them as JS numbers for math.
- One invoice = one payment attempt. To let a customer retry after expiry, create
  a new invoice.
- `externalId` is your join key back to your order; it's also echoed in events.
- Currency `"BTC"`: `amount` is exact BTC (max 8 decimals), no rate involved.
