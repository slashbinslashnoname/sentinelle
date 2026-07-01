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
Auth: send header  x-api-key: <YOUR_API_KEY>  on merchant endpoints
(create a key in the API keys tab).

Create an invoice (price in BTC, EUR or USD — EUR/USD are converted to BTC at a
live rate fetched at creation time):
  POST ${origin}/api/invoices
  body: { "amount": "19.99", "currency": "EUR", "externalId": "order-123" }
  -> { id, amountSat, amountBtc, exchangeRate:{pricePerBtc,currency,source,lockedAt},
       onchain:{address}, lightning:{invoice}, bip21, expiresAt }

"exchangeRate" is the fiat↔BTC rate locked in at creation (null for BTC-priced
invoices); pricePerBtc is 1 BTC in the invoice currency.

Show the customer the on-chain address, the lightning invoice, or the unified
"bip21" string as a QR. The invoice is payable for ~15 minutes.

Get paid in real time over WebSocket (no polling):
  ws ${wsOrigin}/ws?invoice=<INVOICE_ID>
  events: invoice.payment_detected (seen in mempool), invoice.paid, invoice.expired
Or poll: GET ${origin}/api/public/invoices/<INVOICE_ID>  (read the "status" field)`,
    },
    {
      title: "curl — create an invoice",
      body: `curl -X POST ${origin}/api/invoices \\
  -H 'x-api-key: <YOUR_API_KEY>' -H 'content-type: application/json' \\
  -d '{"amount":"19.99","currency":"EUR","externalId":"order-123"}'`,
    },
    {
      title: "JavaScript — create + listen for payment",
      body: `const res = await fetch("${origin}/api/invoices", {
  method: "POST",
  headers: { "x-api-key": "<YOUR_API_KEY>", "content-type": "application/json" },
  body: JSON.stringify({ amount: "0.0005", currency: "BTC" }),
});
const invoice = await res.json();

const ws = new WebSocket("${wsOrigin}/ws?invoice=" + invoice.id);
ws.onmessage = (e) => {
  const ev = JSON.parse(e.data);
  if (ev.type === "invoice.paid") console.log("PAID", invoice.id);
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
