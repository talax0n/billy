import { expect, it } from "vitest";
import { dueBucket, netUnitCost } from "./purchases.ts";
import { rupiah } from "./money.ts";
it("rounds a discounted line's unit cost to whole rupiah", () => { expect(netUnitCost(rupiah(299), 3)).toBe(100); });
it("places due dates into inclusive planning buckets", () => {
  expect(dueBucket("2026-11-12", "2026-11-13")).toBe("late");
  expect(dueBucket("2026-11-20", "2026-11-13")).toBe("within7");
  expect(dueBucket("2026-12-13", "2026-11-13")).toBe("within30");
  expect(dueBucket("2026-12-14", "2026-11-13")).toBe("later");
});
