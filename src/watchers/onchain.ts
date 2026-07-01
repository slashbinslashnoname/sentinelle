/**
 * On-chain settlement watcher.
 *
 * Polls a mempool.space-compatible explorer for each pending invoice's address.
 * Settlement policy is configurable:
 *   - Amounts up to `zeroconfMaxSat` settle as soon as the funds are seen (0-conf,
 *     including mempool) — the fast retail path.
 *   - Larger amounts wait for `confirmations` block confirmations before settling,
 *     so a high-value payment can't be reversed by a mempool double-spend.
 * Either way, the first time any funds appear we emit a "detected" event.
 */

import type { InvoiceService } from "../core/invoiceService.js";
import type { InvoiceRepository } from "../db/repositories.js";

interface AddressStats {
  chain_stats: { funded_txo_sum: number };
  mempool_stats: { funded_txo_sum: number };
}

interface AddressTx {
  status?: { confirmed?: boolean; block_height?: number };
}

export interface ConfirmationPolicy {
  confirmations: number;
  zeroconfMaxSat: bigint;
}

export class OnchainWatcher {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly getService: () => InvoiceService,
    private readonly explorerBaseUrl: () => string,
    private readonly policy: () => ConfirmationPolicy,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly intervalMs = 15_000,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  private url(path: string): string {
    return `${this.explorerBaseUrl().replace(/\/$/, "")}${path}`;
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(this.url(path), { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`explorer HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  private async received(address: string): Promise<{ confirmed: bigint; mempool: bigint }> {
    const data = await this.getJson<AddressStats>(`/api/address/${address}`);
    return {
      confirmed: BigInt(data.chain_stats.funded_txo_sum),
      mempool: BigInt(data.mempool_stats.funded_txo_sum),
    };
  }

  /**
   * Confirmations of the shallowest (most recent) confirmed transaction touching
   * `address`. 0 if none are confirmed yet. Requiring the newest tx to be deep
   * enough guarantees every earlier funding tx is at least as deep.
   */
  private async confirmations(address: string): Promise<number> {
    const [txs, tipText] = await Promise.all([
      this.getJson<AddressTx[]>(`/api/address/${address}/txs`),
      this.fetchImpl(this.url(`/api/blocks/tip/height`), { signal: AbortSignal.timeout(10_000) }).then((r) => {
        if (!r.ok) throw new Error(`explorer HTTP ${r.status}`);
        return r.text();
      }),
    ]);
    const tip = Number(tipText.trim());
    const heights = txs
      .filter((t) => t.status?.confirmed && typeof t.status.block_height === "number")
      .map((t) => t.status!.block_height!);
    if (heights.length === 0 || !Number.isFinite(tip)) return 0;
    return tip - Math.max(...heights) + 1;
  }

  /** One polling pass. Returns the number of invoices settled. */
  async tick(): Promise<number> {
    const pending = this.invoices.listPending().filter((i) => i.onchainAddress !== null);
    const { confirmations: reqConf, zeroconfMaxSat } = this.policy();
    let settled = 0;
    for (const inv of pending) {
      try {
        const { confirmed, mempool } = await this.received(inv.onchainAddress!);
        const total = confirmed + mempool;

        // Any funds seen -> "detected" so a client can show "payment seen…".
        if (total > 0n) {
          this.getService().markDetected(inv.id, {
            via: "onchain",
            receivedSat: total.toString(),
            mempoolSat: mempool.toString(),
          });
        }

        // Small amounts (or confirmations disabled) settle on 0-conf; larger ones
        // must reach the required confirmation depth with confirmed funds.
        const zeroconfOk = reqConf <= 0 || inv.amountSat <= zeroconfMaxSat;
        let ok = false;
        if (zeroconfOk) {
          ok = total >= inv.amountSat;
        } else if (confirmed >= inv.amountSat) {
          const depth = reqConf <= 1 ? 1 : await this.confirmations(inv.onchainAddress!);
          ok = depth >= reqConf;
        }

        if (ok) {
          const result = this.getService().settle(inv.id, "onchain", total, inv.onchainAddress!);
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
