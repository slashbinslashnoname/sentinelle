/**
 * On-chain settlement watcher.
 *
 * Polls a mempool.space-compatible explorer for each pending invoice's address
 * and settles it once the total received (including 0-conf mempool funds) covers
 * the requested amount. For a 15-minute retail window, accepting 0-conf is the
 * intended trade-off; tune by requiring confirmations in your own explorer if
 * you need stronger guarantees.
 */

import type { InvoiceService } from "../core/invoiceService.js";
import type { InvoiceRepository } from "../db/repositories.js";

interface AddressStats {
  chain_stats: { funded_txo_sum: number };
  mempool_stats: { funded_txo_sum: number };
}

export class OnchainWatcher {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly getService: () => InvoiceService,
    private readonly explorerBaseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly intervalMs = 15_000,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  private url(path: string): string {
    return `${this.explorerBaseUrl.replace(/\/$/, "")}${path}`;
  }

  private async received(address: string): Promise<{ confirmed: bigint; mempool: bigint }> {
    const res = await this.fetchImpl(this.url(`/api/address/${address}`), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`explorer HTTP ${res.status}`);
    const data = (await res.json()) as AddressStats;
    return {
      confirmed: BigInt(data.chain_stats.funded_txo_sum),
      mempool: BigInt(data.mempool_stats.funded_txo_sum),
    };
  }

  /** One polling pass. Returns the number of invoices settled. */
  async tick(): Promise<number> {
    const pending = this.invoices
      .listPending()
      .filter((i) => i.onchainAddress !== null);
    let settled = 0;
    for (const inv of pending) {
      try {
        const { confirmed, mempool } = await this.received(inv.onchainAddress!);
        const total = confirmed + mempool;

        // Funds seen but not yet covering the amount -> emit a "detected" event
        // so a subscribed client can show "payment seen, waiting...".
        if (total > 0n) {
          this.getService().markDetected(inv.id, {
            via: "onchain",
            receivedSat: total.toString(),
            mempoolSat: mempool.toString(),
          });
        }

        if (total >= inv.amountSat) {
          const result = this.getService().settle(
            inv.id,
            "onchain",
            total,
            inv.onchainAddress!,
          );
          if (result) {
            settled++;
            this.log(`On-chain payment settled invoice ${inv.id}`);
          }
        }
      } catch (err) {
        this.log(`On-chain poll error for ${inv.id}: ${String(err)}`);
      }
    }
    return settled;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
