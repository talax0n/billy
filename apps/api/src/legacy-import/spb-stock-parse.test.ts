import { describe, expect, it } from "vitest";
import { bestMatch, spbBlocks } from "./spb-stock-parse.ts";

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

describe("bestMatch", () => {
  const products = [
    { id: "a-g", name: "CATYLAC EXTERIOR BASE A GALON", unit: "GALON" },
    { id: "a-p", name: "CATYLAC EXTERIOR BASE A PAIL", unit: "PAIL" },
    { id: "b-g", name: "CATYLAC EXTERIOR BASE B GALON", unit: "GALON" },
    { id: "i-a-g", name: "CATYLAC INTERIOR BASE A GALON", unit: "GALON" },
  ];

  it("reads the fill as billy's unit", () => {
    expect(bestMatch("CATYLAC EXTERIOR BASE A 5 KG", products)).toEqual({ product: products[0], confidence: "pasti" });
    expect(bestMatch("CATYLAC EXTERIOR BASE A 25KG", products)).toEqual({ product: products[1], confidence: "pasti" });
  });

  it("never crosses a base letter or a size, and weighs the words that tell variants apart", () => {
    const dulux = [
      { id: "ws-a", name: "DULUX WEATHERSHIELD BASE A GALON", unit: "GALON" },
      { id: "dirt-a", name: "DULUX WEATHERSHIELD DIRT RESISTANCE BASE A 2,5 LITER", unit: "GALON" },
      { id: "penta-a", name: "DULUX PENTALITE BASE A 2,5 LITER", unit: "GALON" },
      { id: "penta-b", name: "DULUX PENTALITE BASE B 2,5 LITER", unit: "GALON" },
      { id: "penta-a-p", name: "PENTALITE BASE A PAIL", unit: "PAIL" },
      { id: "int-a", name: "CATYLAC INTERIOR BASE A GALON", unit: "GALON" },
    ];
    expect(bestMatch("DULUX WEATHERSHIELD BASE A 2,5 LITER", dulux).product?.id).toBe("ws-a");
    expect(bestMatch("DULUX PENTALITE BASE A 2,5 LITER", dulux).product?.id).toBe("penta-a");
    expect(bestMatch("DULUX PENTALITE BASE A 20 LTR", dulux).product?.id).toBe("penta-a-p");
    expect(bestMatch("DULUX CATYLAC INT BASE A 5 KG", dulux).product?.id).toBe("int-a");
    expect(bestMatch("DULUX PENTALITE BASE C 2,5 LITER", dulux).product).toBeNull();
  });

  it("asks for a check when it is close, and gives up when nothing fits", () => {
    expect(bestMatch("CATYLAC BASE A", products).confidence).toBe("cek");
    expect(bestMatch("TINTA BLK", products)).toEqual({ product: null, confidence: "tidak ketemu" });
  });
});
