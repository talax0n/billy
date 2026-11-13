import { type Db, expenses, invoiceBundles, purchaseInvoices, salesInvoices } from "@billy/db";
import { eq } from "drizzle-orm";

type RevisableTable = typeof salesInvoices | typeof purchaseInvoices | typeof expenses | typeof invoiceBundles;
type DocumentLink = { id: string; number: string } | null;

/**
 * Both ends of an Ubah for the detail page: the document this one replaced ("Perubahan dari")
 * and the one that replaced it ("Diubah →").
 */
export async function revisionLinks(
  db: Db,
  table: RevisableTable,
  doc: { id: string; revisionOf: string | null },
): Promise<{ revisionOf: DocumentLink; revisedBy: DocumentLink }> {
  const link = { id: table.id, number: table.number };
  const [replaced, replacement] = await Promise.all([
    doc.revisionOf ? db.select(link).from(table).where(eq(table.id, doc.revisionOf)) : [],
    db.select(link).from(table).where(eq(table.revisionOf, doc.id)),
  ]);
  return { revisionOf: replaced[0] ?? null, revisedBy: replacement[0] ?? null };
}
