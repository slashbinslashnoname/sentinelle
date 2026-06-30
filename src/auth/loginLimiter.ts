/**
 * In-memory throttle for admin logins. After {@link maxAttempts} consecutive
 * failures from the same client key (IP), that key is locked out for
 * {@link lockoutMs}. A successful login clears the key's failure count.
 *
 * State is per-process and intentionally ephemeral: it protects against online
 * password guessing, not against an attacker who can restart the server.
 */
export class LoginRateLimiter {
  private readonly entries = new Map<string, { fails: number; lockedUntil: number }>();

  constructor(
    private readonly maxAttempts = 3,
    private readonly lockoutMs = 15 * 60 * 1000,
  ) {}

  /** Is this key currently locked out? */
  check(key: string, now: number): { blocked: boolean; retryAfterMs: number } {
    const e = this.entries.get(key);
    if (e && e.lockedUntil > now) {
      return { blocked: true, retryAfterMs: e.lockedUntil - now };
    }
    return { blocked: false, retryAfterMs: 0 };
  }

  /**
   * Record a failed attempt. Once the limit is reached the key is locked and its
   * counter reset, so a fresh batch of attempts is allowed after the lockout.
   */
  recordFailure(key: string, now: number): { locked: boolean; remaining: number } {
    const e = this.entries.get(key) ?? { fails: 0, lockedUntil: 0 };
    e.fails += 1;
    if (e.fails >= this.maxAttempts) {
      e.fails = 0;
      e.lockedUntil = now + this.lockoutMs;
      this.entries.set(key, e);
      return { locked: true, remaining: 0 };
    }
    this.entries.set(key, e);
    return { locked: false, remaining: this.maxAttempts - e.fails };
  }

  /** Clear a key's failure state after a successful login. */
  recordSuccess(key: string): void {
    this.entries.delete(key);
  }

  /** Seconds a locked-out client must wait, for a Retry-After header. */
  get lockoutSeconds(): number {
    return Math.ceil(this.lockoutMs / 1000);
  }
}
