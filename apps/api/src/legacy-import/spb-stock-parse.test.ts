import { describe, expect, it } from "vitest";
import { spbBlocks } from "./spb-stock-parse.ts";

describe("spbBlocks", () => {
  it("reads every side-by-side block with its variant and last stock figure", () => {
    const cells = [
      ["CATYLAC EXTERIOR"],
      [],
      ["BASE A", "5 KG", null, null, null, "BASE A", "25KG"],
      [],
      ["TANGGAL", "MASUK", "KELUAR", "STOCK", null, "TANGGAL", "MASUK", "KELUAR", "STOCK"],
      ["24/04/26", null, null, 8, null, "24/04/26", null, null, 1],
      ["11/05/26", null, 1, 7, "u", "15/06/26", null, 1, 0],
      ["09/08/26", "SO", null, 8, null, null, null, null, null],
      [null, null, null, null, null, null, null, null, null],
    ];
    expect(spbBlocks("CATYLAC EXT", cells)).toEqual([
      { sheet: "CATYLAC EXT", label: "CATYLAC EXTERIOR BASE A 5 KG", qty: 8 },
      { sheet: "CATYLAC EXT", label: "CATYLAC EXTERIOR BASE A 25KG", qty: 0 },
    ]);
  });

  it("leaves out a block that never got a stock figure", () => {
    expect(spbBlocks("TINTA", [["TINTA"], [], ["BLK"], [], ["TANGGAL", "MASUK", "KELUAR", "STOCK"], ["01/05/26", null, null, null]])).toEqual([]);
  });
});
