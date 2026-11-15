import { formatRupiah, type Rupiah } from "@billy/core";
import { type Db, products } from "@billy/db";
import { inArray } from "drizzle-orm";
import type { Actor } from "../env.ts";
import { audit, type AuditEntry } from "./audit.ts";

/**
 * Logs every line sold at a price other than the catalog price, as "x → y" with who did it.
 * Written by the system, not typed by the user, so a "." in the reason field cannot hide it.
 */
export async function logPriceChanges(
  tx: Db,
  actor: Actor,
  doc: { action: "pos.sale.price_change" | "sales.invoice.price_change"; entityId: string; number: string },
  lines: readonly { productId: string; unitPrice: Rupiah }[],
  extra: Pick<AuditEntry, "deviceCode" | "source"> = {},
) {
  const catalog = await tx
    .select({ id: products.id, name: products.name, variant: products.variant, sellPrice: products.sellPrice })
    .from(products)
    .where(inArray(products.id, [...new Set(lines.map((l) => l.productId))]));
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const changes = lines.flatMap((line) => {
    const product = byId.get(line.productId)!;
    if (line.unitPrice === product.sellPrice) return [];
    return [{ productId: line.productId, name: [product.name, product.variant].filter(Boolean).join(" "), from: product.sellPrice, to: line.unitPrice }];
  });
  if (changes.length === 0) return;
  const what = changes.map((c) => `${c.name} ${formatRupiah(c.from)} → ${formatRupiah(c.to)}`).join(", ");
  await audit(tx, actor, {
    action: doc.action,
    entityId: doc.entityId,
    summary: `Harga diubah ${doc.number} · ${what}`,
    before: { prices: changes.map(({ productId, name, from }) => ({ productId, name, price: from })) },
    after: { prices: changes.map(({ productId, name, to }) => ({ productId, name, price: to })) },
    ...extra,
  });
}
