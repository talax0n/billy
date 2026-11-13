import { DomainError, type invoiceBundleInput, type PaginationQuery, rupiah } from "@billy/core";
import { bundleInvoices, contacts, type Db, invoiceBundles, salesInvoices, users } from "@billy/db";
import { and, count, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../env.ts";
import { audit } from "../../lib/audit.ts";
import { likePattern } from "../../lib/search.ts";
import { allocateDocNumber } from "../../lib/doc-number.ts";
import { invoicesWithState } from "../sales/service.ts";

/** Invoices of the given bundles, with their live status. */
async function bundledInvoices(db: Db, bundleIds: string[]) {
  if (bundleIds.length === 0) return [];
  const links = await db
    .select({ bundleId: bundleInvoices.bundleId, invoiceId: bundleInvoices.invoiceId })
    .from(bundleInvoices)
    .where(inArray(bundleInvoices.bundleId, bundleIds));
  const invoices = await invoicesWithState(db, inArray(salesInvoices.id, links.map((l) => l.invoiceId)));
  const byId = new Map(invoices.map((inv) => [inv.id, inv]));
  return links.map((link) => ({ bundleId: link.bundleId, invoice: byId.get(link.invoiceId)! }));
}

export async function listBundles(db: Db, { q, page, pageSize }: PaginationQuery) {
  const where = q ? or(ilike(invoiceBundles.number, likePattern(q)), ilike(contacts.name, likePattern(q))) : undefined;
  const [bundles, [counted]] = await Promise.all([
    db
      .select({
        id: invoiceBundles.id,
        number: invoiceBundles.number,
        date: invoiceBundles.date,
        customerName: contacts.name,
        voidedAt: invoiceBundles.voidedAt,
      })
      .from(invoiceBundles)
      .innerJoin(contacts, eq(contacts.id, invoiceBundles.customerId))
      .where(where)
      .orderBy(desc(invoiceBundles.date), desc(invoiceBundles.number))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: count() })
      .from(invoiceBundles)
      .innerJoin(contacts, eq(contacts.id, invoiceBundles.customerId))
      .where(where),
  ]);
  const linked = await bundledInvoices(db, bundles.map((b) => b.id));
  const rows = bundles.map((bundle) => {
    const invoices = linked.filter((l) => l.bundleId === bundle.id).map((l) => l.invoice);
    return {
      ...bundle,
      invoiceCount: invoices.length,
      total: rupiah(invoices.reduce((sum, inv) => sum + inv.total, 0)),
      outstanding: rupiah(invoices.reduce((sum, inv) => sum + inv.state.outstanding, 0)),
    };
  });
  return { rows, total: counted!.total };
}

export async function getBundle(db: Db, id: string) {
  const [bundle] = await db
    .select({
      id: invoiceBundles.id,
      number: invoiceBundles.number,
      date: invoiceBundles.date,
      note: invoiceBundles.note,
      voidedAt: invoiceBundles.voidedAt,
      createdByName: users.name,
      customer: { id: contacts.id, code: contacts.code, name: contacts.name, address: contacts.address, phone: contacts.phone },
    })
    .from(invoiceBundles)
    .innerJoin(contacts, eq(contacts.id, invoiceBundles.customerId))
    .innerJoin(users, eq(users.id, invoiceBundles.createdBy))
    .where(eq(invoiceBundles.id, id));
  if (!bundle) throw new DomainError("not_found", "Tukar faktur tidak ditemukan");
  const invoices = (await bundledInvoices(db, [id])).map((l) => l.invoice).sort((a, b) => a.date.localeCompare(b.date));
  return {
    ...bundle,
    invoices,
    total: rupiah(invoices.reduce((sum, inv) => sum + inv.total, 0)),
    outstanding: rupiah(invoices.reduce((sum, inv) => sum + inv.state.outstanding, 0)),
  };
}

export async function createBundle(db: Db, input: z.output<typeof invoiceBundleInput>, actor: Actor) {
  return db.transaction(async (tx) => {
    const invoiceIds = [...new Set(input.invoiceIds)];
    const invoices = await invoicesWithState(tx, inArray(salesInvoices.id, invoiceIds));
    const eligible = invoices.filter((inv) => inv.customerId === input.customerId && inv.state.outstanding > 0);
    if (eligible.length !== invoiceIds.length) {
      throw new DomainError("invalid", "Hanya faktur pelanggan ini yang belum lunas dan tidak di-void yang bisa ditukar");
    }
    const [taken] = await tx
      .select({ number: invoiceBundles.number })
      .from(bundleInvoices)
      .innerJoin(invoiceBundles, eq(invoiceBundles.id, bundleInvoices.bundleId))
      .where(and(inArray(bundleInvoices.invoiceId, invoiceIds), isNull(invoiceBundles.voidedAt)))
      .limit(1);
    if (taken) throw new DomainError("conflict", `Sebagian faktur sudah ada di ${taken.number}`);

    const number = await allocateDocNumber(tx, "TF", input.date);
    const [bundle] = await tx
      .insert(invoiceBundles)
      .values({ number, customerId: input.customerId, date: input.date, note: input.note, createdBy: actor.id })
      .returning({ id: invoiceBundles.id });
    await tx.insert(bundleInvoices).values(invoiceIds.map((invoiceId) => ({ bundleId: bundle!.id, invoiceId })));
    await audit(tx, actor, {
      action: "invoice_bundle.create",
      entityId: bundle!.id,
      summary: `Tukar faktur ${number} (${invoiceIds.length} faktur)`,
      after: { number, customerId: input.customerId, date: input.date, invoiceIds },
    });
    return getBundle(tx, bundle!.id);
  });
}

/** A bundle has no side effects to reverse: voiding only frees its invoices for a new bundle. */
export async function voidBundle(db: Db, id: string, actor: Actor) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(invoiceBundles)
      .set({ voidedAt: new Date() })
      .where(and(eq(invoiceBundles.id, id), isNull(invoiceBundles.voidedAt)))
      .returning({ id: invoiceBundles.id, number: invoiceBundles.number, voidedAt: invoiceBundles.voidedAt });
    if (!row) throw new DomainError("conflict", "Tukar faktur tidak ditemukan atau sudah di-void");
    await audit(tx, actor, {
      action: "invoice_bundle.void",
      entityId: id,
      summary: `Void tukar faktur ${row.number}`,
      before: { voidedAt: null },
      after: { voidedAt: row.voidedAt },
    });
    return getBundle(tx, id);
  });
}
