/**
 * SQLite access layer (better-sqlite3, synchronous).
 *
 * The schema is created idempotently on open. WAL mode keeps reads (status
 * polling from the checkout page) from blocking the writer.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint   TEXT NOT NULL,
  xpub          TEXT NOT NULL,
  script_type   TEXT NOT NULL,
  network       TEXT NOT NULL,
  chain         INTEGER NOT NULL,
  next_index    INTEGER NOT NULL DEFAULT 0,
  ceiling       INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE (fingerprint, chain)
);

CREATE TABLE IF NOT EXISTS invoices (
  id                TEXT PRIMARY KEY,
  status            TEXT NOT NULL,            -- pending | paid | expired | canceled
  created_at        INTEGER NOT NULL,         -- epoch ms
  expires_at        INTEGER NOT NULL,         -- epoch ms
  detected_at       INTEGER,                  -- first seen unconfirmed (mempool / LN pending)
  paid_at           INTEGER,
  -- requested price as supplied by the merchant
  price_currency    TEXT NOT NULL,            -- BTC | EUR | USD
  price_minor       TEXT NOT NULL,            -- integer minor units, as text (bigint-safe)
  rate_minor        TEXT,                     -- BTC price in fiat minor units at creation (locked)
  rate_source       TEXT,                     -- provenance of the rate (e.g. "mempool", "fixed")
  -- locked amount to pay
  amount_sat        TEXT NOT NULL,            -- integer sats, as text (bigint-safe)
  -- merchant metadata
  description       TEXT,
  external_id       TEXT,                     -- shop order reference
  metadata_json     TEXT,
  callback_url      TEXT,
  -- on-chain rail
  onchain_account_id INTEGER,                 -- account whose index pool this draws from
  onchain_address   TEXT,
  onchain_index     INTEGER,
  onchain_chain     INTEGER,
  onchain_script    TEXT,
  -- lightning rail
  ln_invoice        TEXT,
  ln_payment_hash   TEXT,
  -- settlement
  paid_via          TEXT,                     -- onchain | lightning
  paid_amount_sat   TEXT,
  paid_reference    TEXT,                     -- txid or payment hash
  -- reimbursements: running total of refunds recorded against this invoice
  refunded_sat      TEXT NOT NULL DEFAULT '0'
);

CREATE INDEX IF NOT EXISTS idx_invoices_status     ON invoices (status);
CREATE INDEX IF NOT EXISTS idx_invoices_expires    ON invoices (expires_at);
CREATE INDEX IF NOT EXISTS idx_invoices_external   ON invoices (external_id);
CREATE INDEX IF NOT EXISTS idx_invoices_lnhash     ON invoices (ln_payment_hash);
CREATE INDEX IF NOT EXISTS idx_invoices_address    ON invoices (onchain_address);

-- Recycled derivation indices: when an invoice expires/cancels without being
-- paid, its (index, address) is returned here so the next invoice reuses it
-- instead of advancing next_index. This keeps the address space densely packed
-- and pushes the index-overflow horizon as far away as possible.
CREATE TABLE IF NOT EXISTS released_indexes (
  account_id   INTEGER NOT NULL,
  idx          INTEGER NOT NULL,
  address      TEXT NOT NULL,
  script_type  TEXT NOT NULL,
  released_at  INTEGER NOT NULL,
  PRIMARY KEY (account_id, idx)
);

-- Runtime-editable key/value settings (e.g. invoice TTL set from the admin API).
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Reimbursements recorded by the admin against an invoice (supports partials).
CREATE TABLE IF NOT EXISTS refunds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id  TEXT NOT NULL,
  amount_sat  TEXT NOT NULL,
  reference   TEXT,
  note        TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refunds_invoice ON refunds (invoice_id);

-- Single admin credential, set via register-on-first-run (no env secret).
CREATE TABLE IF NOT EXISTS admin_auth (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Admin login sessions (opaque bearer tokens, persisted so they survive restart).
CREATE TABLE IF NOT EXISTS admin_sessions (
  token       TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

-- Merchant API keys. We store only the SHA-256 hash; the key is shown once.
CREATE TABLE IF NOT EXISTS api_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  label        TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  prefix       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at   INTEGER
);
`;

export function openDatabase(path: string): DB {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  ensureColumn(db, "invoices", "refunded_sat", "TEXT NOT NULL DEFAULT '0'");
  return db;
}

/** Add a column if it isn't already present (lightweight forward migration). */
function ensureColumn(db: DB, table: string, column: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}
