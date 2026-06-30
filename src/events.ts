/**
 * A tiny synchronous in-process event bus. The invoice service publishes
 * lifecycle events; the WebSocket layer (and anything else) subscribes.
 *
 * Events are intentionally small and JSON-serialisable so they can be relayed
 * over a socket verbatim.
 */

export type InvoiceEventType =
  | "invoice.created"
  | "invoice.payment_detected" // funds seen unconfirmed (mempool) / LN pending
  | "invoice.paid"
  | "invoice.expired"
  | "invoice.canceled";

export interface InvoiceEvent {
  type: InvoiceEventType;
  invoiceId: string;
  /** epoch ms */
  at: number;
  status: string;
  amountSat: string;
  externalId: string | null;
  /** rail-specific detail, e.g. { via: "onchain", receivedSat, reference } */
  detail?: Record<string, unknown>;
}

export type Listener = (event: InvoiceEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: InvoiceEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // A misbehaving subscriber must not break publishing for others.
      }
    }
  }
}
