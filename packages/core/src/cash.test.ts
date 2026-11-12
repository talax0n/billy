import { describe, expect, it } from "vitest";
import { cashBalance, runningBalances, validateTransfer } from "./cash.ts";
import { rupiah } from "./money.ts";

describe("cash", () => {
  const entries = [{ direction: "in" as const, amount: rupiah(100000) }, { direction: "out" as const, amount: rupiah(25000) }];
  it("derives balances with incoming money positive", () => {
    expect(cashBalance(entries)).toBe(75000);
    expect(runningBalances(entries, rupiah(5000)).map((entry) => entry.balance)).toEqual([105000, 80000]);
    expect(cashBalance([])).toBe(0);
  });
  it("rejects invalid transfers", () => {
    expect(() => validateTransfer({ fromAccountId: "a", toAccountId: "a", amount: rupiah(1) })).toThrow();
    expect(() => validateTransfer({ fromAccountId: "a", toAccountId: "b", amount: rupiah(0) })).toThrow();
    expect(() => validateTransfer({ fromAccountId: "a", toAccountId: "b", amount: rupiah(1) })).not.toThrow();
  });
});
