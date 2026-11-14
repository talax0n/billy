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

it("counts a unit price under the catalog price as discount, and a higher price as none", () => {
  const priced = (qty: number, unitPrice: number, listPrice: number, discountAmount = 0) => ({ ...line(qty, unitPrice, discountAmount), listPrice: rupiah(listPrice) });
  const none = { kind: "none", value: 0 } as const;
  // 2 × (100.000 − 94.000) = 12.000 off a 200.000 gross = 6%
  expect(saleLimitBreaches([priced(2, 94_000, 100_000)], none, limits)).toEqual([{ kind: "discount", bp: 600, maxBp: 500 }]);
  expect(saleLimitBreaches([priced(2, 95_000, 100_000)], none, limits)).toEqual([]);
  // 3.000 price cut + 3.000 line discount on 100.000 = 6%
  expect(saleLimitBreaches([priced(1, 97_000, 100_000, 3_000)], none, limits)).toEqual([{ kind: "discount", bp: 600, maxBp: 500 }]);
  // tinted mix at 250.000 on a 185.000 base: gross is 250.000, a 12.500 line discount is exactly 5%
  expect(saleLimitBreaches([priced(1, 250_000, 185_000, 12_500)], none, limits)).toEqual([]);
  expect(combinedDiscountBp([priced(1, 250_000, 185_000, 12_501)], none)).toBe(501);
});
