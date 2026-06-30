/**
 * Lightning settlement watcher.
 *
 * phoenixd pushes a webhook the instant a payment arrives (see http/routes), but
 * webhooks can be missed (restarts, transient network). This poller is the
 * backstop: it asks phoenixd about each pending invoice's payment hash and
 * settles any that are paid. Settlement is idempotent, so racing the webhook is
 * harmless.
 */

import type { InvoiceService } from "../core/invoiceService.js";
import type { InvoiceRepository } from "../db/repositories.js";
import type { PhoenixdClient } from "../phoenixd/client.js";

export class LightningWatcher {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly getService: () => InvoiceService,
    private readonly getPhoenixd: () => PhoenixdClient | null,
    private readonly intervalMs = 10_000,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  /** One polling pass. Returns the number of invoices settled. */
  async tick(): Promise<number> {
    const phoenixd = this.getPhoenixd();
    if (!phoenixd) return 0;
    const pending = this.invoices
      .listPending()
      .filter((i) => i.lnPaymentHash !== null);
    let settled = 0;
    for (const inv of pending) {
      try {
        const payment = await phoenixd.getIncomingPayment(inv.lnPaymentHash!);
        if (payment?.isPaid && payment.receivedSat > 0) {
          const result = this.getService().settle(
            inv.id,
            "lightning",
            BigInt(payment.receivedSat),
            payment.paymentHash,
          );
          if (result) {
            settled++;
            this.log(`Lightning payment settled invoice ${inv.id}`);
          }
        }
      } catch (err) {
        this.log(`Lightning poll error for ${inv.id}: ${String(err)}`);
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
