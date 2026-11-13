import { expect, it } from "vitest";
import { isoDate, money, percentToBp, posNumber, receiptAmount, receiptLines, splitTint } from "./parse.ts";

it("reads the legacy money, date, percent and receipt-number formats", () => {
  expect(money("Rp. 3.460.000,00")).toBe(3_460_000);
  expect(money("10.020.000")).toBe(10_020_000);
  expect(money("Rp. -14.449.721,00")).toBe(-14_449_721);
  expect(money("")).toBe(0);
  expect(isoDate("12/11/2026")).toBe("2026-11-12");
  expect(isoDate("2026-11-12")).toBe("2026-11-12");
  expect(percentToBp("11%")).toBe(1100);
  expect(percentToBp("0%")).toBe(0);
  expect(posNumber("C261112-41")).toBe("C-261112-0041");
});

it("parses receipt item rows and tint notes", () => {
  const rows = [
    ["Nama Barang", "Jumlah"],
    ["KUAS HOMECARE 2,5 IN 2 x 16.000", "32.000"],
    ["KANSAI ECO CLEAN 20 LITER (BRILLIANT WHITE) 3 x 2.000.000", "6.000.000"],
    ["AVITEX GOLD PAIL (N12 004 ) 1 x 967.000 (-48.350)", "918.650"],
    ["Subtotal", "6.032.000"],
    ["Diskon", "0"],
  ];
  expect(receiptLines(rows)).toEqual([
    { name: "KUAS HOMECARE 2,5 IN", qty: 2, unitPrice: 16_000, lineTotal: 32_000 },
    { name: "KANSAI ECO CLEAN 20 LITER (BRILLIANT WHITE)", qty: 3, unitPrice: 2_000_000, lineTotal: 6_000_000 },
    { name: "AVITEX GOLD PAIL (N12 004 )", qty: 1, unitPrice: 967_000, lineTotal: 918_650 },
  ]);
  expect(receiptAmount(rows, "Subtotal")).toBe(6_032_000);
  expect(splitTint("KANSAI ECO CLEAN 20 LITER (BRILLIANT WHITE)")).toEqual({ name: "KANSAI ECO CLEAN 20 LITER", note: "BRILLIANT WHITE" });
  expect(splitTint("KUAS 3 IN")).toEqual({ name: "KUAS 3 IN", note: "" });
});
