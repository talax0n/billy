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

  it("puts a real minus sign before the symbol", () => {
    expect(formatRupiah(rupiah(-250000))).toBe("\u2212Rp 250.000");
  });

  it("drops the symbol for columns whose header carries it", () => {
    expect(formatRupiah(rupiah(-250000), { symbol: false })).toBe("\u2212250.000");
    expect(formatRupiah(rupiah(892000), { symbol: false })).toBe("892.000");
  });

  it("shortens millions and billions when compact", () => {
    expect(formatRupiah(rupiah(-1250000), { compact: true })).toBe("\u2212Rp 1,3 jt");
    expect(formatRupiah(rupiah(51500000000), { compact: true })).toBe("Rp 51,5 M");
    expect(formatRupiah(rupiah(862500), { compact: true })).toBe("Rp 862.500");
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
