import { describe, expect, it } from "vitest";
import { formatRupiah, parseRupiah, rupiah, sumRupiah } from "./money.ts";

describe("rupiah", () => {
  it("rejects fractions and unsafe integers", () => {
    expect(() => rupiah(1.5)).toThrow(RangeError);
    expect(() => rupiah(2 ** 53)).toThrow(RangeError);
  });

  it("formats with Indonesian thousand separators", () => {
    expect(formatRupiah(rupiah(3460000))).toBe("Rp 3.460.000");
    expect(formatRupiah(rupiah(0))).toBe("Rp 0");
  });

  it("parses the legacy display format", () => {
    expect(parseRupiah("Rp. 3.460.000")).toBe(3460000);
    expect(parseRupiah("10.020.000")).toBe(10020000);
    expect(() => parseRupiah("Rp. 3.460.000,50")).toThrow(SyntaxError);
  });

  it("sums exactly", () => {
    expect(sumRupiah([rupiah(1200000), rupiah(2260000)])).toBe(3460000);
  });
});
