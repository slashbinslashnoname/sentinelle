/**
 * Hono authentication middleware.
 *  - Admin endpoints require a valid session token (cookie `sid` or Bearer).
 *  - Merchant endpoints require a valid API key (`x-api-key` or Bearer).
 */

import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type {
  AdminAuthRepository,
  ApiKeyRepository,
} from "../db/authRepositories.js";

function bearer(c: Context): string | null {
  const auth = c.req.header("authorization") ?? "";
  const [scheme, token] = auth.split(" ");
  return scheme === "Bearer" && token ? token : null;
}

export function adminSessionToken(c: Context): string | null {
  return getCookie(c, "sid") ?? bearer(c);
}

export function extractApiKey(c: Context): string | null {
  const headerKey = c.req.header("x-api-key");
  if (headerKey && headerKey.length > 0) return headerKey;
  return bearer(c);
}

export function requireAdmin(
  admin: AdminAuthRepository,
  now: () => number,
): MiddlewareHandler {
  return async (c, next) => {
    const token = adminSessionToken(c);
    if (!token || !admin.isValidSession(token, now())) {
      return c.json({ error: "admin login required" }, 401);
    }
    await next();
  };
}

export function requireMerchant(
  apiKeys: ApiKeyRepository,
  now: () => number,
): MiddlewareHandler {
  return async (c, next) => {
    const provided = extractApiKey(c);
    if (!provided || !apiKeys.verify(provided, now())) {
      return c.json({ error: "invalid or missing API key (x-api-key)" }, 401);
    }
    await next();
  };
}
