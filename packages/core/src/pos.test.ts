import { describe, expect, it } from "vitest";
import { rupiah } from "./money.ts";
import { nextPosNumber } from "./numbering.ts";
import {
  cartTotals,
  initialSyncState,
  parsePosNumber,
  quickTenderAmounts,
  retryDelay,
  type SyncState,
  syncTransition,
  uploadOutcome,
} from "./pos.ts";

const line = (qty: number, unitPrice: number, discountAmount = 0) => ({
  qty,
  unitPrice: rupiah(unitPrice),
  discountAmount: rupiah(discountAmount),
});
const none = { kind: "none", value: 0 } as const;

describe("cartTotals", () => {
  it("is all zeros for an empty cart", () => {
    expect(cartTotals([], none)).toEqual({
      ok: true,
      totals: { lineTotals: [], subtotal: 0, discountAmount: 0, taxAmount: 0, total: 0, gross: 0, lineDiscount: 0 },
    });
  });

  it("matches the mock: gross, line discount, total", () => {
    const result = cartTotals([line(1, 1_200_000), line(6, 95_000, 30_000), line(2, 310_000), line(4, 18_000)], none);
    expect(result).toEqual({
      ok: true,
      totals: {
        lineTotals: [1_200_000, 540_000, 620_000, 72_000],
        subtotal: 2_432_000,
        discountAmount: 0,
        taxAmount: 0,
        total: 2_432_000,
        gross: 2_462_000,
        lineDiscount: 30_000,
      },
    });
  });

  it("applies a transaction discount after line discounts", () => {
    const result = cartTotals([line(3, 33_000, 1_000)], { kind: "percent", value: 1_000 });
    expect(result).toMatchObject({ ok: true, totals: { subtotal: 98_000, discountAmount: 9_800, total: 88_200 } });
  });

  it("explains an impossible discount instead of throwing", () => {
    expect(cartTotals([line(1, 18_000, 20_000)], none)).toEqual({
      ok: false,
      error: "Diskon baris tidak boleh melebihi harga baris",
    });
    expect(cartTotals([line(1, 18_000)], { kind: "amount", value: 18_001 })).toEqual({
      ok: false,
      error: "Diskon melebihi subtotal",
    });
  });
});

describe("quickTenderAmounts", () => {
  it("suggests rounded notes above the total", () => {
    expect(quickTenderAmounts(rupiah(2_432_000))).toEqual([2_450_000, 2_500_000, 3_000_000]);
    expect(quickTenderAmounts(rupiah(32_000))).toEqual([35_000, 40_000, 50_000]);
    expect(quickTenderAmounts(rupiah(185_000))).toEqual([190_000, 200_000, 500_000]);
    expect(quickTenderAmounts(rupiah(3_500))).toEqual([4_000, 5_000, 10_000]);
  });

  it("suggests nothing for an empty sale", () => {
    expect(quickTenderAmounts(rupiah(0))).toEqual([]);
  });
});

describe("receipt numbers", () => {
  it("parses what nextPosNumber formats", () => {
    const next = nextPosNumber("K1", "2026-11-13", { period: "261113", value: 41 });
    expect(parsePosNumber(next.number)).toEqual({ deviceCode: "K1", period: "261113", value: 42 });
    expect(parsePosNumber("K1-261113-12345")).toEqual({ deviceCode: "K1", period: "261113", value: 12345 });
    expect(parsePosNumber("SO-2611-0001")).toBeNull();
  });
});

describe("upload outcome", () => {
  it("removes on 2xx, parks 4xx refusals, retries the rest", () => {
    expect([200, 201].map(uploadOutcome)).toEqual(["done", "done"]);
    expect([400, 403, 404, 409, 422].map(uploadOutcome)).toEqual(["rejected", "rejected", "rejected", "rejected", "rejected"]);
    expect([0, 401, 408, 429, 500, 502, 504].map(uploadOutcome)).toEqual(["retry", "retry", "retry", "retry", "retry", "retry", "retry"]);
  });
});

describe("sync state machine", () => {
  const run = (state: SyncState, ...types: ("went_offline" | "went_online" | "flush" | "failed")[]) =>
    types.reduce((s, type) => syncTransition(s, { type }), state);

  it("starts offline or idle", () => {
    expect(initialSyncState(false)).toEqual({ phase: "offline", failures: 0, lastSyncedAt: null });
    expect(initialSyncState(true).phase).toBe("idle");
  });

  it("flushes, fails into backoff, retries and recovers", () => {
    const backoff = run(initialSyncState(true), "flush", "failed", "flush", "failed");
    expect(backoff).toEqual({ phase: "backoff", failures: 2, lastSyncedAt: null });
    const synced = syncTransition(run(backoff, "flush"), { type: "flushed", at: "2026-11-13T03:00:00.000Z" });
    expect(synced).toEqual({ phase: "idle", failures: 0, lastSyncedAt: "2026-11-13T03:00:00.000Z" });
  });

  it("does not flush while offline and resumes when online", () => {
    const offline = run(initialSyncState(true), "went_offline", "flush");
    expect(offline.phase).toBe("offline");
    expect(run(offline, "went_online", "flush").phase).toBe("syncing");
  });

  it("ignores a second flush while one is in flight", () => {
    expect(run(initialSyncState(true), "flush", "flush", "went_online").phase).toBe("syncing");
  });

  it("backs off exponentially up to a minute", () => {
    expect([0, 1, 2, 3, 6, 10].map(retryDelay)).toEqual([1_000, 2_000, 4_000, 8_000, 60_000, 60_000]);
  });
});
