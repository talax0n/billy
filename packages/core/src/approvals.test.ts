import { expect, it } from "vitest";
import { breachMessage, combinedDiscountBp, saleLimitBreaches } from "./approvals.ts";
import { rupiah } from "./money.ts";

const line = (qty: number, unitPrice: number, discountAmount = 0, unitCost?: number) => ({
  qty,
  unitPrice: rupiah(unitPrice),
  discountAmount: rupiah(discountAmount),
  unitCost: unitCost === undefined ? undefined : rupiah(unitCost),
});
const limits = { kasirMaxDiscountBp: 500, allowBelowCost: false };

it("adds line and document discounts against the gross, rounding up", () => {
  expect(combinedDiscountBp([line(2, 78_000, 6_000)], { kind: "percent", value: 300 })).toBe(674);
  expect(combinedDiscountBp([line(1, 100_000)], { kind: "amount", value: 5_000 })).toBe(500);
  expect(combinedDiscountBp([line(1, 0)], { kind: "none", value: 0 })).toBe(0);
});

it("allows exactly the cap and flags anything over it", () => {
  expect(saleLimitBreaches([line(1, 100_000)], { kind: "percent", value: 500 }, limits)).toEqual([]);
  expect(saleLimitBreaches([line(1, 100_000)], { kind: "percent", value: 501 }, limits)).toEqual([{ kind: "discount", bp: 501, maxBp: 500 }]);
});

it("flags lines under cost only when the cost is known and below-cost sales are not allowed", () => {
  const lines = [line(2, 60_000, 0, 61_000), line(1, 32_000, 0, 24_500), line(1, 10_000)];
  expect(saleLimitBreaches(lines, { kind: "none", value: 0 }, limits)).toEqual([{ kind: "below_cost", lines: [0] }]);
  expect(saleLimitBreaches(lines, { kind: "none", value: 0 }, { ...limits, allowBelowCost: true })).toEqual([]);
  expect(breachMessage([{ kind: "discount", bp: 1_250, maxBp: 500 }, { kind: "below_cost", lines: [0] }])).toBe(
    "Diskon 12,5% melebihi batas kasir 5% per nota. Harga jual di bawah modal tidak diizinkan.",
  );
});
