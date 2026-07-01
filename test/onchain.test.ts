import { describe, it, expect, vi } from "vitest";
import { OnchainWatcher, type ConfirmationPolicy } from "../src/watchers/onchain.js";

const ADDR = "bc1qexampleaddress";

function fakeService() {
  return { markDetected: vi.fn(), settle: vi.fn(() => ({ id: "inv" })) };
}

/** Explorer stub: `confirmedSat`/`mempoolSat` on the address, funded at `blockHeight`. */
function fakeFetch(opts: { confirmedSat: number; mempoolSat: number; blockHeight?: number; tip?: number }) {
  return (async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith(`/api/address/${ADDR}`)) {
      return json({
        chain_stats: { funded_txo_sum: opts.confirmedSat },
        mempool_stats: { funded_txo_sum: opts.mempoolSat },
      });
    }
    if (u.endsWith(`/api/address/${ADDR}/txs`)) {
      return json(opts.blockHeight != null ? [{ status: { confirmed: true, block_height: opts.blockHeight } }] : []);
    }
    if (u.endsWith(`/api/blocks/tip/height`)) {
      return new Response(String(opts.tip ?? 0), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });

function makeWatcher(fetchImpl: typeof fetch, policy: ConfirmationPolicy, requiredConfirmations: number | null = null) {
  const service = fakeService();
  const invoices = {
    listPending: () => [{ id: "inv", onchainAddress: ADDR, amountSat: 20_000n, requiredConfirmations }],
  } as never;
  const w = new OnchainWatcher(invoices, () => service as never, () => "https://ex.test", () => policy, fetchImpl, 1000);
  return { w, service };
}

describe("OnchainWatcher confirmation policy", () => {
  it("settles small amounts on 0-conf when confirmations are disabled", async () => {
    const { w, service } = makeWatcher(fakeFetch({ confirmedSat: 0, mempoolSat: 20_000 }), {
      confirmations: 0,
      zeroconfMaxSat: 0n,
    });
    expect(await w.tick()).toBe(1);
    expect(service.settle).toHaveBeenCalledOnce();
  });

  it("does NOT settle a large amount on 0-conf when confirmations are required", async () => {
    const { w, service } = makeWatcher(fakeFetch({ confirmedSat: 0, mempoolSat: 20_000 }), {
      confirmations: 1,
      zeroconfMaxSat: 10_000n, // 20k > limit -> must confirm
    });
    expect(await w.tick()).toBe(0);
    expect(service.markDetected).toHaveBeenCalledOnce(); // but detected
    expect(service.settle).not.toHaveBeenCalled();
  });

  it("settles a large amount once it has one confirmation", async () => {
    const { w, service } = makeWatcher(fakeFetch({ confirmedSat: 20_000, mempoolSat: 0 }), {
      confirmations: 1,
      zeroconfMaxSat: 10_000n,
    });
    expect(await w.tick()).toBe(1);
    expect(service.settle).toHaveBeenCalledOnce();
  });

  it("waits for the configured depth (2 confs) before settling", async () => {
    // Funded at height 100, tip 100 -> depth 1 (not enough for 2).
    const shallow = makeWatcher(fakeFetch({ confirmedSat: 20_000, mempoolSat: 0, blockHeight: 100, tip: 100 }), {
      confirmations: 2,
      zeroconfMaxSat: 0n,
    });
    expect(await shallow.w.tick()).toBe(0);
    expect(shallow.service.settle).not.toHaveBeenCalled();

    // tip 101 -> depth 2 -> settles.
    const deep = makeWatcher(fakeFetch({ confirmedSat: 20_000, mempoolSat: 0, blockHeight: 100, tip: 101 }), {
      confirmations: 2,
      zeroconfMaxSat: 0n,
    });
    expect(await deep.w.tick()).toBe(1);
    expect(deep.service.settle).toHaveBeenCalledOnce();
  });

  it("still settles below-threshold amounts on 0-conf even when confirmations are required", async () => {
    const { w, service } = makeWatcher(fakeFetch({ confirmedSat: 0, mempoolSat: 20_000 }), {
      confirmations: 3,
      zeroconfMaxSat: 50_000n, // 20k <= limit -> 0-conf ok
    });
    expect(await w.tick()).toBe(1);
    expect(service.settle).toHaveBeenCalledOnce();
  });

  it("per-invoice confirmations override the 0-conf threshold", async () => {
    // Global policy would 0-conf this (amount <= zeroconfMaxSat), but the
    // invoice demands 2 confirmations, so a mempool-only payment must wait.
    const pending = makeWatcher(fakeFetch({ confirmedSat: 0, mempoolSat: 20_000 }), {
      confirmations: 0,
      zeroconfMaxSat: 50_000n,
    }, 2);
    expect(await pending.w.tick()).toBe(0);
    expect(pending.service.markDetected).toHaveBeenCalledOnce();
    expect(pending.service.settle).not.toHaveBeenCalled();

    // With 2 confirmations present, it settles.
    const confirmed = makeWatcher(
      fakeFetch({ confirmedSat: 20_000, mempoolSat: 0, blockHeight: 100, tip: 101 }),
      { confirmations: 0, zeroconfMaxSat: 50_000n },
      2,
    );
    expect(await confirmed.w.tick()).toBe(1);
    expect(confirmed.service.settle).toHaveBeenCalledOnce();
  });

  it("per-invoice confirmations=0 forces instant 0-conf even for large amounts", async () => {
    const { w, service } = makeWatcher(fakeFetch({ confirmedSat: 0, mempoolSat: 20_000 }), {
      confirmations: 6,
      zeroconfMaxSat: 0n, // global would require 6 confs
    }, 0);
    expect(await w.tick()).toBe(1);
    expect(service.settle).toHaveBeenCalledOnce();
  });
});
