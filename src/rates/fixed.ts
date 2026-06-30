import { type RateProvider } from "./provider.js";
import { priceToMinor, type FiatCurrency } from "../money.js";

/**
 * A static rate provider. Handy for offline development and deterministic tests,
 * or for a merchant who wants to pin a rate manually.
 */
export class FixedRateProvider implements RateProvider {
  readonly source = "fixed";
  private readonly prices: Record<FiatCurrency, bigint>;

  constructor(prices: { EUR: string; USD: string }) {
    this.prices = {
      EUR: priceToMinor(prices.EUR, "EUR"),
      USD: priceToMinor(prices.USD, "USD"),
    };
  }

  async btcPriceMinor(currency: FiatCurrency): Promise<bigint> {
    return this.prices[currency];
  }
}
