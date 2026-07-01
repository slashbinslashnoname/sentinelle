// Settings are grouped into well-organised sub-pages. Each field carries help
// text so the admin is self-documenting.

export type FieldType = "text" | "number" | "password" | "boolean" | "select";

export interface FieldDef {
  key: string;
  label: string;
  help?: string;
  type?: FieldType;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export interface SettingsGroup {
  path: string; // route under /settings
  title: string;
  description: string;
  fields: FieldDef[];
  /** Optional inline tool: validate-xpub, test connection, live rates. */
  tool?: "xpub" | "phoenixd" | "explorer" | "email" | "rates";
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    path: "bitcoin",
    title: "Bitcoin (on-chain)",
    description: "Watch-only extended public key used to derive a fresh receive address per invoice.",
    tool: "xpub",
    fields: [
      {
        key: "bitcoin_xpub",
        label: "Extended public key",
        help: "Watch-only account key from your wallet (Sparrow, BlueWallet, Ledger…), used to derive a fresh receive address per invoice — public key only, so the server can receive but never spend. The prefix picks the address type: zpub → native segwit (bc1…), ypub → wrapped segwit (3…), xpub → legacy (1…); testnet uses vpub/upub/tpub. Leave empty for Lightning-only.",
        placeholder: "zpub6r…",
      },
    ],
  },
  {
    path: "lightning",
    title: "Lightning (phoenixd)",
    description: "Connection to your phoenixd node for BOLT11 invoices.",
    tool: "phoenixd",
    fields: [
      {
        key: "phoenixd_url",
        label: "phoenixd URL",
        help: "e.g. http://127.0.0.1:9740. Leave empty to disable Lightning.",
        placeholder: "http://127.0.0.1:9740",
      },
      {
        key: "phoenixd_password",
        label: "phoenixd password",
        help: "The http-password (the limited-access password is enough — we only create/read invoices).",
        type: "password",
      },
      {
        key: "phoenixd_webhook_secret",
        label: "Webhook secret",
        help: "If set, the X-Phoenix-Signature HMAC on /webhooks/phoenixd is verified. Must match phoenix.conf.",
        type: "password",
      },
    ],
  },
  {
    path: "rates",
    title: "Exchange rates",
    description: "How EUR/USD prices are converted to BTC. With the live provider, the rate is fetched fresh at each invoice generation.",
    tool: "rates",
    fields: [
      {
        key: "rate_provider",
        label: "Provider",
        help: "‘mempool’ fetches live rates at invoice time (recommended). ‘fixed’ uses the static prices below (offline/testing).",
        type: "select",
        options: [
          { value: "mempool", label: "mempool (live)" },
          { value: "fixed", label: "fixed (static)" },
        ],
      },
      {
        key: "rate_base_url",
        label: "Rate base URL",
        help: "mempool.space-compatible endpoint used for the live provider.",
        placeholder: "https://mempool.space",
      },
      { key: "fixed_rate_eur", label: "Fixed EUR / BTC", help: "Only used when provider = fixed.", type: "number" },
      { key: "fixed_rate_usd", label: "Fixed USD / BTC", help: "Only used when provider = fixed.", type: "number" },
    ],
  },
  {
    path: "explorer",
    title: "Block explorer",
    description: "Used to detect on-chain payments (including 0-conf mempool).",
    tool: "explorer",
    fields: [
      {
        key: "explorer_url",
        label: "Explorer URL",
        help: "mempool.space-compatible explorer. Point at your own instance for privacy/reliability.",
        placeholder: "https://mempool.space",
      },
      {
        key: "onchain_confirmations",
        label: "Confirmations required",
        help: "Block confirmations before a large on-chain payment is marked paid. 0 = accept 0-conf (mempool) for any amount. A detected invoice waiting for confirmations does not expire at the 15-minute window.",
        type: "number",
      },
      {
        key: "onchain_zeroconf_max_sat",
        label: "0-conf limit (sat)",
        help: "Payments up to this amount settle instantly on 0-conf even when confirmations are required; anything larger waits for the confirmations above. Only used when ‘Confirmations required’ is ≥ 1.",
        type: "number",
      },
    ],
  },
  {
    path: "notifications",
    title: "Email notifications",
    description: "SMTP delivery for payment notifications. Leave the host empty to disable.",
    tool: "email",
    fields: [
      { key: "smtp_host", label: "SMTP host", placeholder: "smtp.example.com" },
      { key: "smtp_port", label: "SMTP port", type: "number", help: "587 for STARTTLS, 465 for implicit TLS." },
      { key: "smtp_secure", label: "Implicit TLS", type: "boolean", help: "true for port 465; false for STARTTLS." },
      { key: "smtp_user", label: "SMTP user" },
      { key: "smtp_pass", label: "SMTP password", type: "password" },
      { key: "email_from", label: "From address", placeholder: "Sentinelle <noreply@example.com>" },
      { key: "email_to", label: "Notify address", help: "Where payment notifications are sent.", placeholder: "you@example.com" },
      {
        key: "notify_events",
        label: "Notify on events",
        help: "Comma-separated. Options: invoice.paid, invoice.payment_detected, invoice.expired, invoice.canceled.",
      },
    ],
  },
  {
    path: "security",
    title: "Security",
    description: "Change the admin password that protects this dashboard.",
    fields: [],
  },
  {
    path: "network",
    title: "Network & invoices",
    description: "Cross-origin access and the invoice payment window.",
    fields: [
      {
        key: "cors_origins",
        label: "CORS origins",
        help: "Comma-separated browser origins allowed to call the API/WebSocket, or * for any. Empty = same-origin only.",
        placeholder: "https://shop.example.com",
      },
      {
        key: "invoice_ttl_seconds",
        label: "Invoice TTL (seconds)",
        help: "How long an invoice stays payable. Default 900 (15 minutes).",
        type: "number",
      },
    ],
  },
];
