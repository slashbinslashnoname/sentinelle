import { Card, CopyBlock, PageHeader } from "../components/ui";

// Copy-ready snippets for a coding assistant. No key is embedded — create one
// in the API keys tab and substitute <YOUR_API_KEY> where shown.
export function Integration() {
  const origin = window.location.origin;
  const wsOrigin = origin.replace(/^http/, "ws");

  const blocks = [
    {
      title: "Integration guide (give this to your LLM)",
      body: `Sentinelle is a self-hosted Bitcoin invoicing gateway. Base URL: ${origin}
Auth: header  x-api-key: <YOUR_API_KEY>  on merchant endpoints (create a key in the API keys tab).

Create an invoice — ALWAYS include a "description".
EUR/USD are converted to BTC at a live rate fetched and locked at creation time.
The payment window and confirmations are set by the OPERATOR (admin), not the
request — they come back as "paymentPolicy".
  POST ${origin}/api/invoices
  body: {
    "amount": "19.99", "currency": "EUR",
    "description": "Order #123",        // shown to the payer (required, use it)
    "externalId": "order-123"
  }
  -> { id, amountSat, amountBtc, expiresAt,
       exchangeRate:{pricePerBtc,currency,source,lockedAt},
       paymentPolicy:{timeoutSeconds,confirmations,zeroconfMaxSat},
       onchain:{address}, lightning:{invoice} }

CHECKOUT UX (do it exactly):
  • Do NOT use bip21. Render two TABS — On-chain and Lightning — each with its OWN QR
    (encode onchain.address and lightning.invoice separately).
  • Show a countdown timer to expiresAt (mm:ss).
  • Subscribe to ws ${wsOrigin}/ws?invoice=<INVOICE_ID>:
      invoice.payment_detected -> REPLACE the QR with a "Payment detected — confirming (0/N)…" panel
      invoice.paid             -> REPLACE it with a "Payment confirmed ✓" panel
      invoice.expired          -> "expired, start over"
    (N = paymentPolicy.confirmations). Poll GET ${origin}/api/public/invoices/<id> as a fallback.
  • Confirm status === "paid" from your backend before fulfilling.

Full reference component + field table: see docs/LLM.md in the repo.`,
    },
    {
      title: "curl — create an invoice",
      body: `curl -X POST ${origin}/api/invoices \\
  -H 'x-api-key: <YOUR_API_KEY>' -H 'content-type: application/json' \\
  -d '{"amount":"19.99","currency":"EUR","description":"Order #123","externalId":"order-123"}'`,
    },
    {
      title: "JavaScript — create + listen (tabs handle the QRs)",
      body: `const res = await fetch("${origin}/api/invoices", {
  method: "POST",
  headers: { "x-api-key": "<YOUR_API_KEY>", "content-type": "application/json" },
  body: JSON.stringify({ amount: "0.0005", currency: "BTC", description: "Order #123" }),
});
const invoice = await res.json();
// Render two tabs: QR of invoice.onchain.address  and  QR of invoice.lightning.invoice.
// Do NOT use bip21.

const ws = new WebSocket("${wsOrigin}/ws?invoice=" + invoice.id);
ws.onmessage = (e) => {
  const ev = JSON.parse(e.data);
  if (ev.type === "invoice.payment_detected") showDetected();   // replace QR: confirming…
  if (ev.type === "invoice.paid") showConfirmed();              // replace QR: confirmed ✓
};`,
    },
  ];

  return (
    <div>
      <PageHeader
        title="LLM integration"
        subtitle="Paste these into your coding assistant. Create an API key in the API keys tab and substitute it where shown."
      />
      <div className="space-y-4">
        {blocks.map((b, i) => (
          <Card key={i}>
            <p className="mb-2 text-sm font-semibold">{b.title}</p>
            <CopyBlock text={b.body} />
          </Card>
        ))}
      </div>
    </div>
  );
}
