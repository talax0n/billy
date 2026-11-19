/** Matching free-text product names (an SPB sheet's label, a staff's chat message) to billy's products. */
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
 * Candidates ranked by how likely each is the product a free-text label names, best first. Size class
 * and base letter must agree; the rest is a Dice score over shared words, each weighted by how rare it
 * is among the candidates, so PENTALITE counts and DULUX barely does.
 */
export function rankProducts<P extends Candidate>(label: string, candidates: readonly P[]): { product: P; score: number }[] {
  const want = describe(label);
  const pool = candidates.map((p) => ({ p, d: describe(`${p.name} ${p.unit}`) }));
  const df = new Map<string, number>();
  for (const { d } of pool) for (const w of d.words) df.set(w, (df.get(w) ?? 0) + 1);
  const weight = (w: string) => Math.log((pool.length + 1) / ((df.get(w) ?? 0) + 0.5));
  const total = (words: Set<string>) => [...words].reduce((sum, w) => sum + weight(w), 0);

  return pool
    .filter(({ d }) => !(want.size && d.size && want.size !== d.size) && !(want.base && d.base && want.base !== d.base))
    .map(({ p, d }) => {
      const shared = [...want.words].filter((w) => d.words.has(w));
      return { product: p, score: (2 * total(new Set(shared))) / (total(want.words) + total(d.words)) };
    })
    .sort((a, b) => b.score - a.score);
}

/** The single best candidate: "pasti" needs a strong score and a clear lead over the runner-up. */
export function bestMatch<P extends Candidate>(label: string, candidates: readonly P[]): { product: P | null; confidence: MatchConfidence } {
  const [best, second] = rankProducts(label, candidates);
  if (!best || best.score < 0.5) return { product: null, confidence: "tidak ketemu" };
  const clear = best.score >= 0.8 && best.score - (second?.score ?? 0) >= 0.1;
  return { product: best.product, confidence: clear ? "pasti" : "cek" };
}
