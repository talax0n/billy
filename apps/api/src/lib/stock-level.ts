import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { products } from "@billy/db";

/** SQL twin of `needsAttention(stockLevel(...))` in @billy/core. */
export const needsAttentionSql = (stock: SQL<number>) => sql`(${stock} < 0 or ${stock} < ${products.minStock})`;
