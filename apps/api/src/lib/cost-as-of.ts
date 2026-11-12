import type { Rupiah } from "@billy/core";
import { sql } from "drizzle-orm";

/**
 * The cost of the product in the current `products` row as of `date` (data-model ground
 * rule 8): the net unit cost of its latest non-voided purchase line dated on or before `date`,
 * falling back to `products.cost_price` when there is none. `date: null` means any date.
 * The net unit cost is `round(line_total / qty)`, the same as `netUnitCost` in @billy/core.
 * Written with explicit table names: drizzle leaves columns unqualified in single-table
 * selects and updates, which a correlated subquery cannot tell apart.
 */
export const costAsOf = (date: string | null) =>
  sql<Rupiah>`coalesce((
    select round(pl.line_total::numeric / pl.qty)
    from purchase_lines pl
    inner join purchase_invoices pi on pi.id = pl.invoice_id
    where pl.product_id = products.id
      and pi.voided_at is null
      ${date === null ? sql`` : sql`and pi.date <= ${date}`}
    order by pi.date desc, pi.created_at desc, pl.position desc
    limit 1
  ), products.cost_price)`.mapWith((v) => Number(v) as Rupiah);
