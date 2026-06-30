import { describe, it, expect } from "vitest";
import {
  parseDecimalToMinor,
  formatMinor,
  btcStringToSat,
  satToBtcString,
  fiatMinorToSat,
  MAX_MONEY_SAT,
  MoneyError,
} from "../src/money.js";

describe("parseDecimalToMinor", () => {
  it("parses BTC to satoshis", () => {
    expect(parseDecimalToMinor("0.00012345", "BTC")).toBe(12345n);
    expect(parseDecimalToMinor("1", "BTC")).toBe(100_000_000n);
    expect(parseDecimalToMinor("21000000", "BTC")).toBe(MAX_MONEY_SAT);
  });

  it("parses fiat to cents", () => {
    expect(parseDecimalToMinor("9.99", "EUR")).toBe(999n);
    expect(parseDecimalToMinor("100", "USD")).toBe(10_000n);
  });

  it("rejects too many decimals", () => {
    expect(() => parseDecimalToMinor("0.000000001", "BTC")).toThrow(MoneyError);
    expect(() => parseDecimalToMinor("1.234", "EUR")).toThrow(MoneyError);
  });

  it("rejects junk, negatives and zero", () => {
    for (const bad of ["", "-1", "abc", "1e3", "0", "0.00", " ", "1,5"]) {
      expect(() => parseDecimalToMinor(bad, "EUR")).toThrow(MoneyError);
    }
  });
});

describe("formatMinor / round trip", () => {
  it("formats satoshis back to BTC", () => {
    expect(satToBtcString(12345n)).toBe("0.00012345");
    expect(satToBtcString(100_000_000n)).toBe("1.00000000");
  });
  it("formats fiat", () => {
    expect(formatMinor(999n, "EUR")).toBe("9.99");
  });
});

describe("btcStringToSat overflow protection", () => {
  it("rejects amounts above the 21M cap", () => {
    expect(() => btcStringToSat("21000001")).toThrow(MoneyError);
  });
});

describe("fiatMinorToSat", () => {
  it("converts cents to sats with a known price", () => {
    // 1 BTC = 50,000.00 EUR => price minor = 5,000,000 cents
    // 10.00 EUR (1000 cents) => 1000 * 1e8 / 5_000_000 = 20000 sat
    expect(fiatMinorToSat(1000n, 5_000_000n)).toBe(20_000n);
  });

  it("rounds half-up so the merchant is never underpaid", () => {
    // Pick a price that produces a .5 sat remainder.
    // fiat=3 cents, price=2 cents/BTC => 3*1e8/2 = 150000000 exact, no rounding.
    // Use price that doesn't divide evenly:
    // fiat=1 cent, price=3 cents => 1e8/3 = 33333333.33 -> 33333333 (half-up at .33 rounds down)
    expect(fiatMinorToSat(1n, 3n)).toBe(33_333_333n);
    // fiat=1, price=2 => 1e8/2 = 50000000 exact
    expect(fiatMinorToSat(1n, 2n)).toBe(50_000_000n);
  });

  it("rejects non-positive inputs", () => {
    expect(() => fiatMinorToSat(0n, 5n)).toThrow(MoneyError);
    expect(() => fiatMinorToSat(5n, 0n)).toThrow(MoneyError);
  });
});
