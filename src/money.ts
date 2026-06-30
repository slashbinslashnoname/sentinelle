/**
 * Money handling for Sentinelle.
 *
 * All Bitcoin amounts are kept as integer satoshis in `bigint` so that no
 * floating-point rounding can ever creep into a payment amount. Fiat amounts
 * are kept as integer *minor units* (cents) — again as `bigint`.
 *
 * The only place we touch decimal strings is at the human boundary
 * (parsing "0.0001" BTC, formatting "1.50" EUR).
 */

export const SATS_PER_BTC = 100_000_000n;

/** 21,000,000 BTC — the hard cap on the number of satoshis that will ever exist. */
export const MAX_MONEY_SAT = 21_000_000n * SATS_PER_BTC;

export type FiatCurrency = "EUR" | "USD";
export type Currency = "BTC" | FiatCurrency;

export const FIAT_CURRENCIES: readonly FiatCurrency[] = ["EUR", "USD"];

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Decimal places for a currency's minor unit (BTC uses 8 = satoshi). */
export function decimalsFor(currency: Currency): number {
  return currency === "BTC" ? 8 : 2;
}

/**
 * Parse a decimal amount string into integer minor units for the given currency.
 * "0.00012345" BTC -> 12345n sat ; "9.99" EUR -> 999n cents.
 *
 * Rejects negatives, NaN, scientific notation and excess precision so that a
 * mistyped price can never silently truncate value.
 */
export function parseDecimalToMinor(amount: string, currency: Currency): bigint {
  const decimals = decimalsFor(currency);
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new MoneyError(`Invalid ${currency} amount: "${amount}"`);
  }
  const parts = trimmed.split(".");
  const whole = parts[0] ?? "0";
  const frac = parts[1] ?? "";
  if (frac.length > decimals) {
    throw new MoneyError(
      `Too many decimals for ${currency}: max ${decimals}, got "${amount}"`,
    );
  }
  const padded = frac.padEnd(decimals, "0");
  const minor = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
  if (minor <= 0n) {
    throw new MoneyError(`Amount must be strictly positive: "${amount}"`);
  }
  return minor;
}

/** Format integer minor units back into a decimal string. 12345n sat -> "0.00012345". */
export function formatMinor(minor: bigint, currency: Currency): string {
  if (minor < 0n) throw new MoneyError("Cannot format a negative amount");
  const decimals = decimalsFor(currency);
  if (decimals === 0) return minor.toString();
  const base = 10n ** BigInt(decimals);
  const whole = minor / base;
  const frac = (minor % base).toString().padStart(decimals, "0");
  return `${whole}.${frac}`;
}

/** Convenience: satoshis -> "0.00012345" BTC. */
export function satToBtcString(sat: bigint): string {
  return formatMinor(sat, "BTC");
}

/** Parse a BTC decimal string ("0.001") into satoshis, validating the money cap. */
export function btcStringToSat(btc: string): bigint {
  const sat = parseDecimalToMinor(btc, "BTC");
  assertWithinMoneyCap(sat);
  return sat;
}

function assertWithinMoneyCap(sat: bigint): void {
  if (sat > MAX_MONEY_SAT) {
    throw new MoneyError(
      `Amount ${sat} sat exceeds the maximum possible supply (${MAX_MONEY_SAT} sat)`,
    );
  }
}

/**
 * Convert a fiat amount (in minor units / cents) to satoshis given the price of
 * one BTC expressed in the same minor units.
 *
 *   sat = fiatMinor * SATS_PER_BTC / btcPriceMinor   (rounded half-up)
 *
 * Rounding is half-up so the merchant is never *underpaid* by a sub-satoshi.
 */
export function fiatMinorToSat(fiatMinor: bigint, btcPriceMinor: bigint): bigint {
  if (fiatMinor <= 0n) throw new MoneyError("Fiat amount must be positive");
  if (btcPriceMinor <= 0n) throw new MoneyError("BTC price must be positive");

  const numerator = fiatMinor * SATS_PER_BTC;
  // Round half-up: add half the divisor before the integer division.
  const sat = (numerator + btcPriceMinor / 2n) / btcPriceMinor;
  assertWithinMoneyCap(sat);
  if (sat <= 0n) {
    throw new MoneyError("Converted amount rounds down to 0 sat; price too low");
  }
  return sat;
}

/** Parse a price-per-BTC decimal string ("60000.50") into fiat minor units. */
export function priceToMinor(price: string, currency: FiatCurrency): bigint {
  const minor = parseDecimalToMinor(price, currency);
  return minor;
}
