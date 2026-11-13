import { expect, it } from "vitest";
import { adjustedReceipt, isoDate, money, percentToBp, posNumber, receiptAmount, receiptLines, splitTint } from "./parse.ts";

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

it("keeps a receipt's printed total and puts the gap on one adjustment amount", () => {
  const above = adjustedReceipt([
    ["CAT A (MERAH) 2 x 50.000", "110.000"],
    ["KUAS 1 x 20.000 (-2.000)", "18.000"],
    ["Subtotal", "128.000"],
    ["Diskon", "8.000"],
    ["Total Tagihan", "120.000"],
  ]);
  expect(above.lines.map((l) => [l.qty, l.unitPrice, l.discountAmount, l.appLineTotal])).toEqual([
    [2, 50_000, 0, 100_000],
    [1, 20_000, 2_000, 18_000],
  ]);
  expect(above).toMatchObject({ computedTotal: 110_000, total: 120_000, adjustment: 10_000, subtotal: 128_000, discount: 8_000 });

  const below = adjustedReceipt([["KUAS 3 x 10.000", "30.000"], ["Diskon", "0"], ["Total Tagihan", "25.000"]]);
  expect(below).toMatchObject({ computedTotal: 30_000, total: 25_000, adjustment: -5_000, subtotal: 25_000 });
});
