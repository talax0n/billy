export interface SearchableProduct {
  name: string;
  variant: string;
  code: string | null;
  barcode: string | null;
  categoryName?: string | null;
}

const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * How well a product matches a search, lower is better: 0 the query is the exact code or barcode,
 * 1 every term is a whole word of the name or variant ("putih 5" → "Putih 5 kg"), 2 every term
 * starts such a word, 3 every term appears somewhere. null: some term is missing.
 */
export function productMatchRank(product: SearchableProduct, query: string): 0 | 1 | 2 | 3 | null {
  const q = query.trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return null;
  if (q === product.code?.toLowerCase() || q === product.barcode?.toLowerCase()) return 0;
  const haystack = [product.name, product.variant, product.code, product.barcode, product.categoryName].join(" ").toLowerCase();
  if (!terms.every((term) => haystack.includes(term))) return null;
  const nameWords = words(`${product.name} ${product.variant}`);
  if (terms.every((term) => nameWords.includes(term))) return 1;
  if (terms.every((term) => nameWords.some((word) => word.startsWith(term)))) return 2;
  return 3;
}

/** The products matching `query`, best match first; ties keep their incoming order. */
export function rankProducts<P extends SearchableProduct>(products: readonly P[], query: string): P[] {
  return products
    .map((product) => ({ product, rank: productMatchRank(product, query) }))
    .filter((match): match is { product: P; rank: 0 | 1 | 2 | 3 } => match.rank !== null)
    .sort((a, b) => a.rank - b.rank)
    .map((match) => match.product);
}
