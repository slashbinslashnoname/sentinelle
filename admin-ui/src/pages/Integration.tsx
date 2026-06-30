import { useMemo, useState } from "react";

// Copy-ready snippets for a coding assistant. The current origin and a chosen
// API key are substituted so the output is paste-and-go.
export function Integration() {
  const [key, setKey] = useState("");
  const origin = window.location.origin;
  const wsOrigin = origin.replace(/^http/, "ws");
  const k = key || "<YOUR_API_KEY>";

  const blocks = useMemo(
    () => [
      {
        title: "Integration guide (give this to your LLM)",
        body: `Sentinelle is a self-hosted Bitcoin invoicing gateway. Base URL: ${origin}
Auth: send header  x-api-key: ${k}  on merchant endpoints.

Create an invoice (price in BTC, EUR or USD):
  POST ${origin}/api/invoices
  body: { "amount": "19.99", "currency": "EUR", "externalId": "order-123" }
  -> { id, amountSat, amountBtc, onchain:{address}, lightning:{invoice}, bip21, expiresAt }

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
  -H 'x-api-key: ${k}' -H 'content-type: application/json' \\
  -d '{"amount":"19.99","currency":"EUR","externalId":"order-123"}'`,
      },
      {
        title: "JavaScript — create + listen for payment",
        body: `const res = await fetch("${origin}/api/invoices", {
  method: "POST",
  headers: { "x-api-key": "${k}", "content-type": "application/json" },
  body: JSON.stringify({ amount: "0.0005", currency: "BTC" }),
});
const invoice = await res.json();

const ws = new WebSocket("${wsOrigin}/ws?invoice=" + invoice.id);
ws.onmessage = (e) => {
  const ev = JSON.parse(e.data);
  if (ev.type === "invoice.paid") console.log("PAID", invoice.id);
};`,
      },
    ],
    [origin, wsOrigin, k],
  );

  return (
    <div>
      <h2>LLM integration</h2>
      <p className="muted">Paste these into your coding assistant. Pick an API key (create one in the API keys tab) to embed it.</p>
      <div className="card">
        <label>API key to embed</label>
        <input placeholder="snl_… (paste a key you created)" value={key} onChange={(e) => setKey(e.target.value)} />
      </div>
      {blocks.map((b, i) => (
        <div className="card copywrap" key={i}>
          <b>{b.title}</b>
          <pre>{b.body}</pre>
          <button onClick={() => navigator.clipboard.writeText(b.body)}>copy</button>
        </div>
      ))}
    </div>
  );
}
