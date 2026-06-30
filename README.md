# 🛡️ Sentinelle

A small, self-hosted **Bitcoin invoicing gateway** you can plug your shop into.

Give it a price in **BTC, EUR or USD** and it returns a Bitcoin invoice payable
for **15 minutes** (configurable), on two rails at once:

- **On-chain** — a fresh address derived from your **xpub / ypub / zpub** (your
  keys never touch the server; it only holds the *public* key).
- **Lightning** — a BOLT11 invoice from your own **[phoenixd](https://phoenix.acinq.co/server)** node.

It is **test-driven**, has a structured architecture, a **React + Tailwind admin**
(sidebar, light/dark, structured settings, sortable invoices), real-time
**WebSocket** payment events, **email notifications**, manual **reimbursements**,
and a **compliant accounting export** in CSV/XLSX (the fiat↔BTC conversion is
locked at order time).

---

## Why it's safe by design

- **Watch-only.** Only an extended *public* key is configured; Sentinelle can
  receive but never spend on-chain.
- **Index-overflow protection.** BIP32 non-hardened indices are bounded to
  `[0, 2³¹-1]` and to a configurable ceiling; allocation is atomic.
- **Index recycling.** When an invoice expires or is canceled unpaid, its
  derivation index/address is returned to a pool and **reused** before the
  counter advances — so abandoned addresses are filled in, not burned.
- **No secrets in `.env`.** The admin password is set on first run; merchant
  credentials are revocable API keys. Everything operational lives in the DB.
- **Money is integer-only.** All amounts are `bigint` satoshis/cents — no
  floating point ever touches a payment amount.

---

## Architecture

```
                         ┌──────────────────────────────────────────┐
  POST /api/invoices ───▶│ InvoiceService                           │
  (BTC / EUR / USD)      │  • rate → locked sat amount (at order)   │
                         │  • derive on-chain address (xpub)        │──▶ SQLite
                         │  • create phoenixd BOLT11                │   (better-sqlite3)
                         └───────────────┬──────────────────────────┘
                                         │ events
        watchers (poll)  ◀───────────────┤  EventBus ──▶ WebSocket /ws
        • lightning (phoenixd)           │            └▶ EmailNotifier (SMTP)
        • on-chain (mempool explorer)    │
        phoenixd webhook ────────────────┘
```

Source layout (`src/`):

| Area | Files |
|------|-------|
| Money / overflow-safe math | `money.ts` |
| HD derivation (SLIP-132 + index guard) | `bitcoin/slip132.ts`, `bitcoin/derivation.ts` |
| Persistence | `db/database.ts`, `db/repositories.ts`, `db/authRepositories.ts` |
| Rates | `rates/*` (mempool / fixed) |
| phoenixd client | `phoenixd/client.ts` |
| Core | `core/invoiceService.ts`, `events.ts`, `settings.ts`, `runtime.ts` |
| Watchers | `watchers/lightning.ts`, `watchers/onchain.ts` |
| Notifications | `notifications/*` |
| HTTP/WS (Hono) | `http/*` |
| Admin UI (React) | `admin-ui/` |

---

## Quick start

Requires **Node ≥ 20** and **pnpm**.

```bash
pnpm install
cp .env.example .env        # only PORT / HOST / DATABASE_PATH live here

# run backend + React admin together (hot reload)
pnpm dev
#   server → http://localhost:8080
#   admin  → http://localhost:5173/admin   (proxies the API to :8080)

# or production: build the admin, then run the single server that also
# serves the built admin at /admin
pnpm build
pnpm start                  # http://localhost:8080  (admin at /admin)
```

### First run

1. Open **`/admin`** and **register** an admin password (stored hashed; this is
   the only credential bootstrap).
2. In **Settings**, set at least one rail:
   - `bitcoin_xpub` — your account-level xpub/ypub/zpub (use **Validate xpub**).
   - and/or `phoenixd_url` + `phoenixd_password`.
   - optionally `explorer_url`, `invoice_ttl_seconds`, `cors_origins`, SMTP.
3. In **API keys**, create a key for your shop.
4. Use the **LLM integration** tab to copy a ready-made integration guide.

---

## Using the API

All money in responses is a string. Amounts are locked when the invoice is
created and cannot change for its lifetime.

### Create an invoice

```bash
curl -X POST http://localhost:8080/api/invoices \
  -H 'x-api-key: snl_your_key' \
  -H 'content-type: application/json' \
  -d '{ "amount": "19.99", "currency": "EUR", "externalId": "order-123" }'
```

```jsonc
{
  "id": "8f3c…",                       // unguessable id — use it in URLs/WS
  "status": "pending",
  "expiresAt": 1782853200000,
  "amountSat": "39980",
  "amountBtc": "0.00039980",
  "price": { "currency": "EUR", "minor": "1999" },
  "rateMinor": "5000000",              // 50,000.00 EUR/BTC, locked at order
  "rateSource": "mempool",
  "onchain": { "address": "bc1q…", "scriptType": "p2wpkh", "index": 0 },
  "lightning": { "invoice": "lnbc…", "paymentHash": "…" },
  "bip21": "bitcoin:bc1q…?amount=0.00039980&lightning=LNBC…"
}
```

Show the customer the on-chain `address`, the `lightning.invoice`, or the
unified `bip21` string as a QR — modern wallets pick whichever rail they prefer.

Currencies: `"BTC"` (price is exact BTC, no rate), `"EUR"`, `"USD"`.

### Get / cancel (merchant)

```bash
curl http://localhost:8080/api/invoices/<id>            -H 'x-api-key: snl_…'
curl -X POST http://localhost:8080/api/invoices/<id>/cancel -H 'x-api-key: snl_…'
```

### Public status (no key — addressed by the unguessable id)

```bash
curl http://localhost:8080/api/public/invoices/<id>
```

### Real-time payment events (WebSocket)

```js
const ws = new WebSocket("ws://localhost:8080/ws?invoice=" + invoiceId);
ws.onmessage = (e) => {
  const ev = JSON.parse(e.data);
  // invoice.payment_detected  → funds seen in the mempool (0-conf)
  // invoice.paid              → settled
  // invoice.expired / .canceled
};
```

For an all-events firehose (server-to-server), authenticate with a key:
`ws://localhost:8080/ws?key=snl_your_key`.

### phoenixd webhook

Point phoenixd at `POST /webhooks/phoenixd`. If you set `phoenixd_webhook_secret`
in settings, the `X-Phoenix-Signature` HMAC is verified. The poller is a backstop
so a missed webhook still settles the invoice.

### Reimbursements (admin)

Record a refund (full or partial) against a paid invoice — for your books, not a
status change:

```
POST /api/admin/invoices/<id>/refunds   { "amountSat": 5000, "reference": "txid", "note": "…" }
GET  /api/admin/invoices/<id>/refunds
```

The cumulative refunded amount can't exceed what was received; the invoice keeps
its `paid` status and gains a `refundedSat` total that flows into the export.

### Accounting export (admin)

```
GET /api/admin/export.csv?from=2026-01-01&to=2026-12-31&status=paid
GET /api/admin/export.xlsx?from=…&to=…          # native Excel / Numbers
```

One row per invoice with the **conversion locked at order time**: order currency
and amount, BTC unit price, rate source, sats requested/received, **refunded and
net** sats, payment rail and reference, and UTC timestamps. CSV opens in Excel,
Apple Numbers and Google Sheets; XLSX is the native spreadsheet format.

---

## Settings reference

Set via the admin UI or `PUT /api/admin/settings` (admin session). Secrets are
write-only and never returned.

| Key | Meaning |
|-----|---------|
| `invoice_ttl_seconds` | Payment window (default 900 = 15 min) |
| `bitcoin_xpub` | Account-level xpub/ypub/zpub (empty = Lightning only) |
| `bitcoin_chain` | Derivation chain (0 = receive) |
| `address_index_ceiling` | Hard cap on the derivation index (≤ 2³¹-1) |
| `phoenixd_url` / `phoenixd_password` | phoenixd connection (empty = on-chain only) |
| `phoenixd_webhook_secret` | HMAC secret for the phoenixd webhook |
| `explorer_url` | mempool.space-compatible explorer for on-chain detection |
| `rate_provider` | `mempool` (live) or `fixed` |
| `rate_base_url` | rate endpoint for the mempool provider |
| `fixed_rate_eur` / `fixed_rate_usd` | static prices for `rate_provider=fixed` |
| `cors_origins` | comma-separated browser origins, or `*` |
| `smtp_host` `smtp_port` `smtp_secure` `smtp_user` `smtp_pass` | SMTP for email |
| `email_from` / `email_to` | notification addresses |
| `notify_events` | events that email you (default `invoice.paid`) |

---

## Testing

```bash
pnpm test          # vitest: money, derivation, recycling, service, auth, HTTP+WS, CSV
pnpm typecheck
```

The suite is fully offline (fixed-rate provider, in-memory SQLite, a BIP84 test
vector for derivation) and covers the index-overflow guard, index recycling,
idempotent settlement, the register→login→key→invoice→webhook→WebSocket flow,
and the accounting CSV.

---

## Notes & limitations

- On-chain detection accepts **0-conf** (mempool) — appropriate for a 15-minute
  retail flow. Require confirmations in your own explorer if you need stronger
  guarantees.
- Register-on-first-run means the admin page is open until you set a password —
  keep the service bound to localhost / behind your tunnel until you've done so.
- Dev-only advisories in the vitest/esbuild chain do not affect the shipped
  runtime.

See [`docs/LLM.md`](docs/LLM.md) for a compact spec to hand to a coding assistant.
