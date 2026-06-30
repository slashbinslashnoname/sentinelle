import { RateError, type RateProvider } from "./provider.js";
import type { FiatCurrency } from "../money.js";

interface PricesResponse {
  USD?: number;
  EUR?: number;
  [k: string]: number | undefined;
}

/**
 * Live rates from a mempool.space-compatible endpoint (`/api/v1/prices`).
 * Responses are integer fiat units per BTC; we convert to minor units (cents).
 * A short in-memory cache avoids hammering the API under load.
 */
export class MempoolRateProvider implements RateProvider {
  readonly source = "mempool";
  private cache: { at: number; data: PricesResponse } | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly cacheTtlMs = 60_000,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async prices(): Promise<PricesResponse> {
    if (this.cache && this.now() - this.cache.at < this.cacheTtlMs) {
      return this.cache.data;
    }
    const url = `${this.baseUrl.replace(/\/$/, "")}/api/v1/prices`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      throw new RateError(`Failed to reach rate provider at ${url}: ${String(err)}`);
    }
    if (!res.ok) {
      throw new RateError(`Rate provider returned HTTP ${res.status}`);
    }
    const data = (await res.json()) as PricesResponse;
    this.cache = { at: this.now(), data };
    return data;
  }

  async btcPriceMinor(currency: FiatCurrency): Promise<bigint> {
    const data = await this.prices();
    const value = data[currency];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new RateError(`Rate provider has no usable price for ${currency}`);
    }
    // Integer fiat per BTC -> minor units. Round to nearest cent.
    return BigInt(Math.round(value * 100));
  }
}
