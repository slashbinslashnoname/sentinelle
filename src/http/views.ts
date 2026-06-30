/**
 * Serialisation of domain objects to JSON-safe shapes. Bigints become strings
 * and we distinguish a full (merchant/admin) view from a public (checkout) view
 * that omits merchant-private fields.
 */

import { satToBtcString } from "../money.js";
import { toBip21, type InvoiceService } from "../core/invoiceService.js";
import type { Invoice } from "../db/repositories.js";

function base(invoice: Invoice) {
  return {
    id: invoice.id,
    status: invoice.status,
    createdAt: invoice.createdAt,
    expiresAt: invoice.expiresAt,
    detectedAt: invoice.detectedAt,
    paidAt: invoice.paidAt,
    expiresInSeconds: Math.max(0, Math.round((invoice.expiresAt - Date.now()) / 1000)),
    price: {
      currency: invoice.priceCurrency,
      // priceMinor is sats for BTC, cents for fiat — expose both raw and human.
      minor: invoice.priceMinor.toString(),
    },
    amountSat: invoice.amountSat.toString(),
    amountBtc: satToBtcString(invoice.amountSat),
    rateMinor: invoice.rateMinor === null ? null : invoice.rateMinor.toString(),
    rateSource: invoice.rateSource,
    onchain: invoice.onchainAddress
      ? {
          address: invoice.onchainAddress,
          scriptType: invoice.onchainScript,
          index: invoice.onchainIndex,
          chain: invoice.onchainChain,
        }
      : null,
    lightning: invoice.lnInvoice
      ? { invoice: invoice.lnInvoice, paymentHash: invoice.lnPaymentHash }
      : null,
    bip21: toBip21(invoice),
  };
}

/** Full view for the merchant/admin (includes private metadata). */
export function fullView(invoice: Invoice) {
  return {
    ...base(invoice),
    description: invoice.description,
    externalId: invoice.externalId,
    metadata: invoice.metadata,
    callbackUrl: invoice.callbackUrl,
    paidVia: invoice.paidVia,
    paidAmountSat: invoice.paidAmountSat === null ? null : invoice.paidAmountSat.toString(),
    paidReference: invoice.paidReference,
  };
}

/** Public view for the checkout page (no merchant-private fields). */
export function publicView(invoice: Invoice) {
  const b = base(invoice);
  return {
    ...b,
    description: invoice.description,
    paidVia: invoice.paidVia,
  };
}

export type { InvoiceService };
