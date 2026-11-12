import { describe, expect, it } from "vitest";
import { rupiah } from "./money.ts";
import { dueBucket, netUnitCost } from "./purchases.ts";

describe("netUnitCost", () => {
  it("spreads the line discount over the units", () => {
    // 2 × Rp 10.000 − Rp 2.000 line discount = Rp 18.000
    expect(netUnitCost(rupiah(18_000), 2)).toBe(9_000);
  });

  it("rounds half up to whole rupiah", () => {
    expect(netUnitCost(rupiah(299), 3)).toBe(100);
    expect(netUnitCost(rupiah(301), 2)).toBe(151);
  });
});

describe("dueBucket", () => {
  const today = "2026-11-13";

  it("puts past-due bills in late", () => {
    expect(dueBucket("2026-11-12", today)).toBe("late");
  });

  it("counts today through 7 days ahead as due within 7 days", () => {
    expect(dueBucket("2026-11-13", today)).toBe("within7");
    expect(dueBucket("2026-11-20", today)).toBe("within7");
  });

  it("splits 8–30 days from later", () => {
    expect(dueBucket("2026-11-21", today)).toBe("within30");
    expect(dueBucket("2026-12-13", today)).toBe("within30");
    expect(dueBucket("2026-12-14", today)).toBe("later");
  });
});
