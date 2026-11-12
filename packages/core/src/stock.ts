export type StockLevel = "negative" | "low" | "empty" | "ok";

/**
 * One rule for every stock warning. `low` means under the minimum; reaching the minimum
 * exactly is still fine. A product with no minimum is only `empty` at zero.
 */
export function stockLevel(stock: number, minStock: number): StockLevel {
  if (stock < 0) return "negative";
  if (stock < minStock) return "low";
  if (stock === 0) return "empty";
  return "ok";
}

/** Levels that need someone to restock or recount. */
export const needsAttention = (level: StockLevel) => level === "negative" || level === "low";
