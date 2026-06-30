/**
 * Subscribes to the event bus and emails the operator when configured invoice
 * events fire (by default, payment received). Reads the mailer and recipient
 * lazily so admin settings changes apply without a restart. Send failures are
 * logged, never thrown — a payment must still settle even if email is down.
 */

import { satToBtcString } from "../money.js";
import type { EventBus, InvoiceEvent } from "../events.js";
import type { AppSettings } from "../settings.js";
import type { Mailer } from "./mailer.js";

export class EmailNotifier {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly events: EventBus,
    private readonly settings: AppSettings,
    private readonly getMailer: () => Mailer | null,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.events.subscribe((event) => {
      void this.handle(event);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private async handle(event: InvoiceEvent): Promise<void> {
    if (!this.settings.emailEnabled()) return;
    if (!this.settings.notifyEvents().includes(event.type)) return;
    const mailer = this.getMailer();
    if (!mailer) return;

    const to = this.settings.emailTo();
    const from = this.settings.emailFrom() || to;
    try {
      await mailer.send({
        to,
        from,
        subject: this.subject(event),
        text: this.body(event),
      });
    } catch (err) {
      this.log(`email notification failed: ${String(err)}`);
    }
  }

  private subject(event: InvoiceEvent): string {
    const amount = `${satToBtcString(BigInt(event.amountSat))} BTC`;
    switch (event.type) {
      case "invoice.paid":
        return `✅ Payment received — ${amount}`;
      case "invoice.payment_detected":
        return `⏳ Payment detected — ${amount}`;
      case "invoice.expired":
        return `⌛ Invoice expired — ${amount}`;
      case "invoice.canceled":
        return `🚫 Invoice canceled — ${amount}`;
      case "invoice.refunded":
        return `↩️ Reimbursement recorded — ${amount}`;
      default:
        return `Invoice ${event.type} — ${amount}`;
    }
  }

  private body(event: InvoiceEvent): string {
    const lines = [
      `Event:     ${event.type}`,
      `Invoice:   ${event.invoiceId}`,
      `Amount:    ${satToBtcString(BigInt(event.amountSat))} BTC (${event.amountSat} sat)`,
      `Status:    ${event.status}`,
      `Order ref: ${event.externalId ?? "—"}`,
      `At:        ${new Date(event.at).toISOString()}`,
    ];
    if (event.detail) {
      lines.push(`Detail:    ${JSON.stringify(event.detail)}`);
    }
    return lines.join("\n");
  }
}
