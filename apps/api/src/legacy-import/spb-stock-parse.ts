import type { SheetCell } from "@billy/core";

/** One variant's stock card in an SPB sheet: what it is called there and its last STOCK figure. */
export interface SpbBlock {
  sheet: string;
  /** Tab title plus the cells above the block, e.g. "CATYLAC EXTERIOR BASE A 5 KG". */
  label: string;
  qty: number;
}

const HEADER = ["TANGGAL", "MASUK", "KELUAR", "STOCK"];
const text = (cell: SheetCell | undefined) => (cell === null || cell === undefined ? "" : String(cell).trim().replace(/\s+/g, " "));

/**
 * Finds every TANGGAL | MASUK | KELUAR | STOCK block in one tab of a shop's SPB stock sheet. The label
 * is the tab title (row 1, or the tab name) plus the nearest non-empty cells above the header; the
 * quantity is the last number in the STOCK column below it. A block with no number is left out.
 */
export function spbBlocks(sheetName: string, cells: readonly (readonly SheetCell[])[]): SpbBlock[] {
  const title = cells[0]?.map(text).find(Boolean) ?? sheetName;
  const headers: { row: number; col: number }[] = [];
  cells.forEach((row, r) =>
    row.forEach((_, c) => {
      if (HEADER.every((h, i) => text(row[c + i]).toUpperCase() === h)) headers.push({ row: r, col: c });
    }),
  );

  const blocks: SpbBlock[] = [];
  for (const { row, col } of headers) {
    const nextHeader = headers.find((h) => h.col === col && h.row > row)?.row ?? cells.length;
    let above: string[] = [];
    for (let r = row - 1; r > 0 && above.length === 0; r--) above = [0, 1, 2, 3].map((i) => text(cells[r]?.[col + i])).filter(Boolean);
    let qty: number | null = null;
    for (let r = row + 1; r < nextHeader; r++) {
      const value = cells[r]?.[col + 3];
      if (typeof value === "number") qty = value;
    }
    if (qty === null) continue;
    const words = [...title.split(" "), ...above.join(" ").split(" ")];
    // "DULUX AQUASHIELD 1KG" above a block titled "DULUX AQUASHIELD 1KG" should not read twice.
    const label = words.filter((w, i) => words.indexOf(w) === i).join(" ");
    blocks.push({ sheet: sheetName, label, qty: Math.max(0, Math.round(qty)) });
  }
  return blocks;
}
