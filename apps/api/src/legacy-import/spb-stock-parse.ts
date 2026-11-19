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

const FILL = /\b(\d+(?:\.\d+)?) (?:L|LT|LTR|LITER|KG)\b/g;
const SIZE_WORDS = /^(L|LT|LTR|LITER|KG|GALON|GLN|PAIL)$/;

/** Billy sells tins as LITER, GALON or PAIL; SPB sheets write the fill ("2,5 LITER", "25KG", "GLN"). */
function sizeClass(text: string): string | null {
  const fill = [...text.matchAll(FILL)][0];
  if (fill) {
    const amount = Number(fill[1]);
    return amount >= 15 ? "PAIL" : amount >= 2 ? "GALON" : "LITER";
  }
  const word = /\b(PAIL|GALON|GLN|LITER|LTR)\b/.exec(text)?.[1];
  return word === "GLN" ? "GALON" : word === "LTR" ? "LITER" : (word ?? null);
}

const SYNONYMS: Record<string, string> = { INT: "INTERIOR", EXT: "EXTERIOR", WS: "WEATHERSHIELD" };

/** The words that name a variant, with its size and base letter split out so they can be compared exactly. Codes like DR-2000 keep their number. */
function describe(raw: string) {
  const text = raw
    .toUpperCase()
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/(\d)(KG|LTR|LT|LITER|L)\b/g, "$1 $2")
    .replace(/\bEASY CLEAN\b/g, "EASYCLEAN")
    .replace(/[^A-Z0-9.]+/g, " ")
    .trim();
  const words = text.replace(FILL, " ").split(" ").map((w) => SYNONYMS[w] ?? w);
  return {
    size: sizeClass(text),
    base: /\bBASE ([A-Z])\b/.exec(text)?.[1] ?? null,
    words: new Set(words.filter((w) => w && !SIZE_WORDS.test(w))),
  };
}

export interface Candidate {
  id: string;
  name: string;
  unit: string;
}

export type MatchConfidence = "pasti" | "cek" | "tidak ketemu";

/**
 * The billy product an SPB label most likely is. Size class and base letter must agree; the rest is a
 * Dice score over shared words, each weighted by how rare it is among the candidates, so PENTALITE
 * counts and DULUX barely does. "pasti" needs a strong score and a clear lead over the runner-up.
 */
export function bestMatch(label: string, candidates: readonly Candidate[]): { product: Candidate | null; confidence: MatchConfidence } {
  const want = describe(label);
  const pool = candidates.map((p) => ({ p, d: describe(`${p.name} ${p.unit}`) }));
  const df = new Map<string, number>();
  for (const { d } of pool) for (const w of d.words) df.set(w, (df.get(w) ?? 0) + 1);
  const weight = (w: string) => Math.log((pool.length + 1) / ((df.get(w) ?? 0) + 0.5));
  const total = (words: Set<string>) => [...words].reduce((sum, w) => sum + weight(w), 0);

  const scored = pool
    .filter(({ d }) => !(want.size && d.size && want.size !== d.size) && !(want.base && d.base && want.base !== d.base))
    .map(({ p, d }) => {
      const shared = [...want.words].filter((w) => d.words.has(w));
      return { p, score: (2 * total(new Set(shared))) / (total(want.words) + total(d.words)) };
    })
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (!best || best.score < 0.5) return { product: null, confidence: "tidak ketemu" };
  const clear = best.score >= 0.8 && best.score - (second?.score ?? 0) >= 0.1;
  return { product: best.p, confidence: clear ? "pasti" : "cek" };
}
