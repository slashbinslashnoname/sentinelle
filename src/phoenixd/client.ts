/**
 * Minimal phoenixd HTTP client. Covers exactly what an invoicing gateway needs:
 * creating Bolt11 invoices and reading their settlement status.
 *
 * Auth is HTTP Basic with an empty username and the phoenixd http-password.
 * Only the `createinvoice` and read endpoints are used, so the phoenixd
 * "limited-access" secondary password is sufficient and recommended.
 */

export interface CreateInvoiceParams {
  description: string;
  amountSat: bigint;
  expirySeconds: number;
  externalId?: string;
  webhookUrl?: string;
}

export interface CreatedInvoice {
  amountSat: number;
  paymentHash: string;
  serialized: string;
}

export interface IncomingPayment {
  paymentHash: string;
  isPaid: boolean;
  isExpired?: boolean;
  receivedSat: number;
  externalId?: string | null;
}

export interface NodeInfo {
  nodeId: string;
  channels?: unknown[];
}

export interface PhoenixdClient {
  createInvoice(params: CreateInvoiceParams): Promise<CreatedInvoice>;
  getIncomingPayment(paymentHash: string): Promise<IncomingPayment | null>;
  getInfo(): Promise<NodeInfo>;
}

export class PhoenixdError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "PhoenixdError";
  }
}

export class HttpPhoenixdClient implements PhoenixdClient {
  private readonly authHeader: string;

  constructor(
    private readonly baseUrl: string,
    password: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.authHeader = "Basic " + Buffer.from(`:${password}`).toString("base64");
  }

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }

  async createInvoice(params: CreateInvoiceParams): Promise<CreatedInvoice> {
    if (params.description.length > 128) {
      throw new PhoenixdError("Invoice description exceeds 128 characters");
    }
    const body = new URLSearchParams();
    body.set("description", params.description);
    body.set("amountSat", params.amountSat.toString());
    body.set("expirySeconds", String(params.expirySeconds));
    if (params.externalId) body.set("externalId", params.externalId);
    if (params.webhookUrl) body.set("webhookUrl", params.webhookUrl);

    const res = await this.fetchImpl(this.url("/createinvoice"), {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new PhoenixdError(
        `createinvoice failed: ${await safeText(res)}`,
        res.status,
      );
    }
    return (await res.json()) as CreatedInvoice;
  }

  async getIncomingPayment(paymentHash: string): Promise<IncomingPayment | null> {
    const res = await this.fetchImpl(this.url(`/payments/incoming/${paymentHash}`), {
      method: "GET",
      headers: { Authorization: this.authHeader },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new PhoenixdError(
        `get incoming payment failed: ${await safeText(res)}`,
        res.status,
      );
    }
    return (await res.json()) as IncomingPayment;
  }

  async getInfo(): Promise<NodeInfo> {
    const res = await this.fetchImpl(this.url("/getinfo"), {
      method: "GET",
      headers: { Authorization: this.authHeader },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new PhoenixdError(`getinfo failed: ${await safeText(res)}`, res.status);
    }
    return (await res.json()) as NodeInfo;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return `HTTP ${res.status} ${await res.text()}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}
