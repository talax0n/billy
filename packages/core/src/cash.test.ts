import { expect, it } from "vitest";
import { manualCashCategory, monthRange, reversalOf, transferMovements } from "./cash.ts";
import { rupiah } from "./money.ts";

it("moves a transfer out of the source and into the destination", () => {
  expect(transferMovements({ fromAccountId: "kas", toAccountId: "bca", date: "2026-11-13", amount: rupiah(2_500_000) })).toEqual([
    { accountId: "kas", date: "2026-11-13", direction: "out", amount: 2_500_000 },
    { accountId: "bca", date: "2026-11-13", direction: "in", amount: 2_500_000 },
  ]);
});

it("reverses an entry on the same account and date in the opposite direction", () => {
  expect(reversalOf({ accountId: "kas", date: "2026-11-02", direction: "out", amount: rupiah(150_000) })).toEqual({
    accountId: "kas",
    date: "2026-11-02",
    direction: "in",
    amount: 150_000,
  });
  expect(reversalOf({ accountId: "bca", date: "2026-11-02", direction: "in", amount: rupiah(1) }).direction).toBe("out");
});

it("categorises manual cash by direction", () => {
  expect(manualCashCategory("in")).toBe("other_in");
  expect(manualCashCategory("out")).toBe("other_out");
});

it("turns a month into a half-open date range, across the year end", () => {
  expect(monthRange("2026-11")).toEqual({ from: "2026-11-01", until: "2026-12-01" });
  expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", until: "2027-01-01" });
  expect(monthRange("2027-01")).toEqual({ from: "2027-01-01", until: "2027-02-01" });
});
