import { describe, expect, it } from "vitest";
import { readCountSheet } from "./count-sheet.ts";

describe("readCountSheet", () => {
  it("finds the header under a title and reads columns in any order", () => {
    const { rows, issues } = readCountSheet([
      ["Opname Dulux, SPB Andi"],
      [],
      ["Stok fisik", "Nama barang", "Catatan"],
      [6, "CATYLAC EXTERIOR BASE A GALON", "rak 2"],
      ["  12 ", "  weathershield   base b pail ", null],
      [0, "DULUX TINTER GR1 LITER", null],
    ]);
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      { row: 4, id: null, code: null, name: "CATYLAC EXTERIOR BASE A GALON", qty: 6 },
      { row: 5, id: null, code: null, name: "weathershield base b pail", qty: 12 },
      { row: 6, id: null, code: null, name: "DULUX TINTER GR1 LITER", qty: 0 },
    ]);
  });

  it("skips rows left empty and reports bad ones by Excel row", () => {
    const { rows, issues } = readCountSheet([
      ["ID", "Kode", "Nama barang", "Satuan", "Stok sistem", "Stok fisik"],
      ["a1", "K-1", "Kuas", "PCS", 4, null],
      ["a2", null, "Roll", "PCS", 4, "lima"],
      ["a3", null, "Amplas", "LBR", 4, -2],
      ["a4", null, "Thinner", "LTR", 4, 2.5],
      [null, null, null, null, null, 3],
      ["a5", "K-5", "Dempul", "KG", 4, "7"],
    ]);
    expect(rows).toEqual([{ row: 7, id: "a5", code: "K-5", name: "Dempul", qty: 7 }]);
    expect(issues).toEqual([
      { row: 3, reason: 'Stok fisik "lima" bukan bilangan bulat 0 atau lebih' },
      { row: 4, reason: 'Stok fisik "-2" bukan bilangan bulat 0 atau lebih' },
      { row: 5, reason: 'Stok fisik "2.5" bukan bilangan bulat 0 atau lebih' },
      { row: 6, reason: "Tidak ada ID, Kode atau Nama barang" },
    ]);
  });

  it("refuses a sheet without the required columns", () => {
    expect(() => readCountSheet([["TANGGAL", "MASUK", "KELUAR", "STOCK"]])).toThrow('Kolom "Stok fisik"');
  });
});
