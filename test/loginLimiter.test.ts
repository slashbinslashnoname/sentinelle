import { describe, it, expect } from "vitest";
import { LoginRateLimiter } from "../src/auth/loginLimiter.js";

describe("LoginRateLimiter", () => {
  it("locks a key after the third failure", () => {
    const lim = new LoginRateLimiter(3, 1000);
    expect(lim.recordFailure("ip", 0)).toEqual({ locked: false, remaining: 2 });
    expect(lim.recordFailure("ip", 0)).toEqual({ locked: false, remaining: 1 });
    expect(lim.recordFailure("ip", 0)).toEqual({ locked: true, remaining: 0 });
    expect(lim.check("ip", 0).blocked).toBe(true);
  });

  it("releases the lock after the lockout window", () => {
    const lim = new LoginRateLimiter(3, 1000);
    for (let i = 0; i < 3; i++) lim.recordFailure("ip", 0);
    expect(lim.check("ip", 500).blocked).toBe(true);
    expect(lim.check("ip", 1001).blocked).toBe(false);
  });

  it("tracks keys independently", () => {
    const lim = new LoginRateLimiter(3, 1000);
    for (let i = 0; i < 3; i++) lim.recordFailure("a", 0);
    expect(lim.check("a", 0).blocked).toBe(true);
    expect(lim.check("b", 0).blocked).toBe(false);
  });

  it("a success clears the failure count", () => {
    const lim = new LoginRateLimiter(3, 1000);
    lim.recordFailure("ip", 0);
    lim.recordFailure("ip", 0);
    lim.recordSuccess("ip");
    // Counter reset: it takes three fresh failures to lock again.
    expect(lim.recordFailure("ip", 0).locked).toBe(false);
    expect(lim.recordFailure("ip", 0).locked).toBe(false);
    expect(lim.recordFailure("ip", 0).locked).toBe(true);
  });
});
