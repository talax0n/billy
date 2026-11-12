import { describe, expect, it } from "vitest";
import { DomainError } from "./errors.ts";
import { applyBasisPoints, computeLineTotal, computeTotals, type LineInput } from "./invoice.ts";
import { rupiah } from "./money.ts";

const line = (qty: number, unitPrice: number, discountAmount = 0): LineInput => ({
  qty,
  unitPrice: rupiah(unitPrice),
  discountAmount: rupiah(discountAmount),
});

describe("applyBasisPoints", () => {
  it("rounds half up to whole rupiah", () => {
    expect(applyBasisPoints(rupiah(1_005), 1_100)).toBe(111); // 110,55
    expect(applyBasisPoints(rupiah(1_000), 1_250)).toBe(125);
    expect(applyBasisPoints(rupiah(10), 450)).toBe(0); // 0,45
    expect(applyBasisPoints(rupiah(100), 50)).toBe(1); // 0,5
  });

  it("stays exact past 2^53 intermediate values", () => {
    expect(applyBasisPoints(rupiah(9_000_000_000_000), 1_100)).toBe(990_000_000_000);
  });
});

describe("computeLineTotal", () => {
  it("subtracts the line discount", () => {
    expect(computeLineTotal(line(3, 125_000, 15_000))).toBe(360_000);
  });

  it("rejects zero qty and discounts above the line", () => {
    expect(() => computeLineTotal(line(0, 1_000))).toThrow(DomainError);
    expect(() => computeLineTotal(line(1, 1_000, 1_001))).toThrow(DomainError);
  });
});

describe("computeTotals", () => {
  const lines = [line(2, 245_000), line(1, 87_500, 2_500)];

  it("adds lines with no discount and no tax", () => {
    expect(computeTotals(lines, { kind: "none", value: 0 })).toEqual({
      lineTotals: [490_000, 85_000],
      subtotal: 575_000,
      discountAmount: 0,
      taxAmount: 0,
      total: 575_000,
    });
  });

  it("applies a percent discount in basis points, then PPN on the discounted base", () => {
    // 575.000 × 2,5% = 14.375; base 560.625 × 11% = 61.668,75 → 61.669
    expect(computeTotals(lines, { kind: "percent", value: 250 }, 1_100)).toEqual({
      lineTotals: [490_000, 85_000],
      subtotal: 575_000,
      discountAmount: 14_375,
      taxAmount: 61_669,
      total: 622_294,
    });
  });

  it("applies an amount discount", () => {
    expect(computeTotals(lines, { kind: "amount", value: 75_000 }).total).toBe(500_000);
  });

  it("rejects bad discounts, tax rates and empty documents", () => {
    expect(() => computeTotals(lines, { kind: "amount", value: 575_001 })).toThrow(DomainError);
    expect(() => computeTotals(lines, { kind: "percent", value: 10_001 })).toThrow(DomainError);
    expect(() => computeTotals(lines, { kind: "none", value: 0 }, -1)).toThrow(DomainError);
    expect(() => computeTotals([], { kind: "none", value: 0 })).toThrow(DomainError);
  });
});
