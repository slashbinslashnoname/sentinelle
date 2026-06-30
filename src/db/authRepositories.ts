/**
 * Persistence for admin credentials/sessions and merchant API keys.
 */

import type { DB } from "./database.js";
import {
  generateApiKey,
  hashPassword,
  hashToken,
  randomToken,
  verifyPassword,
} from "../auth/passwords.js";

export class AdminAuthRepository {
  constructor(private readonly db: DB) {}

  isRegistered(): boolean {
    const row = this.db.prepare(`SELECT 1 FROM admin_auth WHERE id = 1`).get();
    return Boolean(row);
  }

  /** Set the admin password. Used for first-run register and password change. */
  setPassword(password: string, now: number): void {
    const hash = hashPassword(password);
    this.db
      .prepare(
        `INSERT INTO admin_auth (id, password_hash, created_at, updated_at)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at`,
      )
      .run(hash, now, now);
  }

  verifyPassword(password: string): boolean {
    const row = this.db
      .prepare(`SELECT password_hash FROM admin_auth WHERE id = 1`)
      .get() as { password_hash: string } | undefined;
    if (!row) return false;
    return verifyPassword(password, row.password_hash);
  }

  /** Create a session and return its bearer token. */
  createSession(now: number, ttlMs: number): string {
    const token = randomToken();
    this.db
      .prepare(
        `INSERT INTO admin_sessions (token, created_at, expires_at) VALUES (?, ?, ?)`,
      )
      .run(token, now, now + ttlMs);
    return token;
  }

  isValidSession(token: string, now: number): boolean {
    const row = this.db
      .prepare(`SELECT expires_at FROM admin_sessions WHERE token = ?`)
      .get(token) as { expires_at: number } | undefined;
    return Boolean(row && row.expires_at > now);
  }

  deleteSession(token: string): void {
    this.db.prepare(`DELETE FROM admin_sessions WHERE token = ?`).run(token);
  }

  purgeExpiredSessions(now: number): void {
    this.db.prepare(`DELETE FROM admin_sessions WHERE expires_at <= ?`).run(now);
  }
}

export interface ApiKeyInfo {
  id: number;
  label: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export class ApiKeyRepository {
  constructor(private readonly db: DB) {}

  /** Create a key, returning the plaintext ONCE (never stored). */
  create(label: string, now: number): { plaintext: string; info: ApiKeyInfo } {
    const { key, hash, prefix } = generateApiKey();
    const res = this.db
      .prepare(
        `INSERT INTO api_keys (label, key_hash, prefix, created_at) VALUES (?, ?, ?, ?)`,
      )
      .run(label.slice(0, 64) || "unnamed", hash, prefix, now);
    return {
      plaintext: key,
      info: {
        id: Number(res.lastInsertRowid),
        label,
        prefix,
        createdAt: now,
        lastUsedAt: null,
      },
    };
  }

  /** Verify a presented key; returns true if it maps to an active key. */
  verify(key: string, now: number): boolean {
    const hash = hashToken(key);
    const row = this.db
      .prepare(`SELECT id FROM api_keys WHERE key_hash = ?`)
      .get(hash) as { id: number } | undefined;
    if (!row) return false;
    this.db
      .prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`)
      .run(now, row.id);
    return true;
  }

  /** Permanently remove a key row. Any app still presenting it will fail auth. */
  delete(id: number): boolean {
    const res = this.db.prepare(`DELETE FROM api_keys WHERE id = ?`).run(id);
    return res.changes > 0;
  }

  list(): ApiKeyInfo[] {
    const rows = this.db
      .prepare(
        `SELECT id, label, prefix, created_at, last_used_at FROM api_keys ORDER BY created_at DESC`,
      )
      .all() as {
      id: number;
      label: string;
      prefix: string;
      created_at: number;
      last_used_at: number | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      prefix: r.prefix,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
    }));
  }
}
