/**
 * Password hashing (scrypt) and random token/key generation, using only the
 * Node standard library — no external crypto dependency.
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEYLEN = 32;
const SALTLEN = 16;

/** Hash a password to a self-describing `scrypt$<salt>$<hash>` string. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALTLEN);
  const dk = scryptSync(password, salt, KEYLEN);
  return `scrypt$${salt.toString("hex")}$${dk.toString("hex")}`;
}

/** Constant-time verify a password against a stored hash. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "hex");
  const expected = Buffer.from(parts[2]!, "hex");
  let dk: Buffer;
  try {
    dk = scryptSync(password, salt, expected.length);
  } catch {
    return false;
  }
  return dk.length === expected.length && timingSafeEqual(dk, expected);
}

/** A URL-safe random token (session id). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Generate a merchant API key and its lookup hash. The key is shown once. */
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `snl_${randomBytes(24).toString("base64url")}`;
  return { key, hash: hashToken(key), prefix: key.slice(0, 12) };
}

/** SHA-256 hash of a token/key, hex — what we persist instead of the secret. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
