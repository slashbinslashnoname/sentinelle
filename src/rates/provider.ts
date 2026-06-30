import type { FiatCurrency } from "../money.js";

/**
 * A RateProvider returns the price of 1 BTC expressed in fiat *minor units*
 * (cents). Returning minor units keeps the rest of the system in integer math.
 */
export interface RateProvider {
  /** Provenance label recorded with each invoice for accounting (e.g. "mempool"). */
  readonly source: string;
  /** Price of 1 BTC in minor units of `currency` (e.g. EUR cents). */
  btcPriceMinor(currency: FiatCurrency): Promise<bigint>;
}

export class RateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateError";
  }
}
