/**
 * Which brand (kept as a product category) a product belongs to, read from the start of its name.
 * Sub-brand prefixes come from the shop's per-brand stock sheets. A name no rule knows stays without a
 * brand, for the admin to assign by hand.
 */
export const brandRules: readonly { brand: string; prefixes: readonly string[] }[] = [
  { brand: "Dulux", prefixes: ["DULUX", "CATYLAC", "WEATHERSHIELD", "PENTALITE", "EASYCLEAN", "EASY CLEAN", "AMBIANCE", "AQUASHIELD"] },
  {
    brand: "Nippon Paint",
    prefixes: [
      "NIPPON", "NIPPE", "NIPPELUX", "WEATHERBOND", "SPOTLESS", "FLAWLESS", "HYDROFAST", "ELASTEX", "VINILEX", "MATEX",
      "SPORTSKOTE", "SPORTKOTE", "BODELAC", "BEE", "Q-LUC", "QLUC", "PYLOX", "EPOXYGUARD",
    ],
  },
  {
    brand: "Propan",
    prefixes: [
      "PROPAN", "DECOR", "ECO", "CERIA", "ULTRAPROOF", "TENNOKOTE", "SENGKOTE", "GO FAST", "GOFAST", "FIBERKOTE", "ACRYLUX",
      "DUROGLOSS", "PRIMTOP", "MULTIFOX", "PUC", "PUL", "ULTRAN", "IMPRA", "METALKOTE", "TRAFFIKOTE", "P 05",
    ],
  },
  { brand: "Avian", prefixes: ["AVIAN", "AVITEX", "NO DROP", "SUNGUARD", "YOKO", "BELMAS", "ARIES"] },
  { brand: "Danapaint", prefixes: ["DANAPAINT", "DANAGLOSS", "DANAPLAS", "DANALAC", "DANACRYL", "DANABRITE", "DANASHIELD"] },
  { brand: "Mowilex", prefixes: ["MOWILEX", "WEATHERCOAT", "EMCO", "CENDANA"] },
  { brand: "Kansai", prefixes: ["KANSAI"] },
  { brand: "Aquaproof", prefixes: ["AQUAPROOF"] },
  { brand: "Epodur", prefixes: ["EPODUR"] },
  { brand: "Seiv", prefixes: ["SEIV"] },
  { brand: "Metrolite", prefixes: ["METROLITE"] },
  { brand: "Dempul", prefixes: ["DEMPUL"] },
  { brand: "Kuas", prefixes: ["KUAS"] },
  { brand: "Thinner", prefixes: ["THINNER"] },
  { brand: "Amplas", prefixes: ["AMPLAS"] },
  { brand: "Lem", prefixes: ["LEM"] },
  { brand: "Spray gun", prefixes: ["SPRAY GUN", "SPRAYGUN"] },
];

const prefixToBrand = brandRules
  .flatMap(({ brand, prefixes }) => prefixes.map((prefix) => ({ prefix, brand })))
  // Longest first, so "NIPPELUX" is tried before "NIPPE" and "GO FAST" before any shorter prefix.
  .sort((a, b) => b.prefix.length - a.prefix.length);

/** The brand a product name starts with, or null. "BEE BRAND 1000" is Nippon; "BEEHIVE" is not. */
export function brandOf(productName: string): string | null {
  const name = productName.trim().toUpperCase().replace(/\s+/g, " ");
  for (const { prefix, brand } of prefixToBrand) {
    if (name === prefix || name.startsWith(`${prefix} `)) return brand;
  }
  return null;
}
