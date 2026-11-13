import {
  businessDate,
  changedFields,
  computeTotals,
  DomainError,
  formatRupiah,
  type posDraftCancelInput,
  type posDraftInput,
} from "@billy/core";
import { categories, contacts, type Db, type DocumentLine, posDrafts, posSales, products, users } from "@billy/db";
import { and, desc, eq, getTableColumns, inArray } from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../env.ts";
import { authorize, pinApprover, type Requirement } from "../../lib/approval.ts";
import { audit } from "../../lib/audit.ts";
import { allocateDocNumber } from "../../lib/doc-number.ts";

type DraftInput = z.output<typeof posDraftInput>;
type Draft = typeof posDrafts.$inferSelect;

/** The stored content of a draft, totals recomputed on the server. Refuses unknown or inactive products. */
async function draftContent(tx: Db, input: DraftInput) {
  const ids = [...new Set(input.lines.map((l) => l.productId))];
  const known = await tx.select({ id: products.id }).from(products).where(and(inArray(products.id, ids), eq(products.active, true)));
  if (known.length !== ids.length) throw new DomainError("invalid", "Produk tidak ditemukan atau nonaktif");
  if (input.customerId) {
    const [customer] = await tx.select({ kind: contacts.kind }).from(contacts).where(eq(contacts.id, input.customerId));
    if (customer?.kind !== "customer") throw new DomainError("invalid", "Pelanggan tidak ditemukan");
  }
  const totals = computeTotals(input.lines, input.discount);
  const lines: DocumentLine[] = input.lines.map(({ productId, qty, unitPrice, discountAmount, note }) => ({ productId, qty, unitPrice, discountAmount, note }));
  return {
    customerId: input.customerId,
    lines,
    subtotal: totals.subtotal,
    discountKind: input.discount.kind,
    discountValue: input.discount.kind === "none" ? 0 : input.discount.value,
    discountAmount: totals.discountAmount,
    total: totals.total,
  };
}

type Content = Awaited<ReturnType<typeof draftContent>>;
const contentOf = (d: Draft): Content => ({
  customerId: d.customerId,
  lines: d.lines,
  subtotal: d.subtotal,
  discountKind: d.discountKind,
  discountValue: d.discountValue,
  discountAmount: d.discountAmount,
  total: d.total,
});

/** Locks an open draft; a paid or cancelled one cannot change any more. */
async function lockOpen(tx: Db, id: string) {
  const [draft] = await tx.select().from(posDrafts).where(eq(posDrafts.id, id)).for("update");
  if (!draft) throw new DomainError("not_found", "Nota sementara tidak ditemukan");
  if (draft.status !== "open") {
    throw new DomainError("conflict", `Nota sementara ${draft.number} sudah ${draft.status === "paid" ? "dibayar" : "dibatalkan"}`);
  }
  return draft;
}

/** Writes new content when it differs, with an audit event holding the changed fields before and after. */
async function applyEdit(tx: Db, draft: Draft, next: Content, actor: Actor) {
  const diff = changedFields(contentOf(draft), next);
  if (!diff) return;
  await tx.update(posDrafts).set({ ...next, updatedAt: new Date() }).where(eq(posDrafts.id, draft.id));
  await audit(tx, actor, {
    action: "pos.draft.update",
    entityId: draft.id,
    summary: `Ubah ${draft.number} ${formatRupiah(draft.total)} → ${formatRupiah(next.total)}`,
    before: diff.before,
    after: diff.after,
  });
}

/**
 * Nota sementara: an unpaid cart kept on the server, numbered `S-…`, shared by every Kasir
 * device and online only. It moves no stock and no money until it is paid, when it becomes a
 * normal POS sale (`recordSale` with the draft id) and turns `paid`. It is never deleted.
 */
export async function createDraft(db: Db, input: DraftInput, actor: Actor) {
  const id = await db.transaction(async (tx) => {
    const content = await draftContent(tx, input);
    const date = businessDate();
    const number = await allocateDocNumber(tx, "S", date);
    const [draft] = await tx.insert(posDrafts).values({ ...content, number, date, createdBy: actor.id }).returning({ id: posDrafts.id });
    await audit(tx, actor, {
      action: "pos.draft.create",
      entityId: draft!.id,
      summary: `Nota sementara ${number} ${formatRupiah(content.total)}`,
      after: { number, ...content },
    });
    return draft!.id;
  });
  return getDraft(db, id);
}

const listColumns = { ...getTableColumns(posDrafts), createdByName: users.name, customerName: contacts.name, saleNumber: posSales.number };
const selectDrafts = (db: Db) =>
  db
    .select(listColumns)
    .from(posDrafts)
    .innerJoin(users, eq(users.id, posDrafts.createdBy))
    .leftJoin(contacts, eq(contacts.id, posDrafts.customerId))
    .leftJoin(posSales, eq(posSales.id, posDrafts.saleId));

/** Open drafts, newest first: the same list on every Kasir device. */
export async function listOpenDrafts(db: Db) {
  const rows = await selectDrafts(db).where(eq(posDrafts.status, "open")).orderBy(desc(posDrafts.createdAt));
  return { rows, total: rows.length };
}

/** The draft with each line's product, enough for a Kasir device to load it into its cart. */
export async function getDraft(db: Db, id: string) {
  const [draft] = await selectDrafts(db).where(eq(posDrafts.id, id));
  if (!draft) throw new DomainError("not_found", "Nota sementara tidak ditemukan");
  const ids = draft.lines.map((l) => l.productId);
  const catalog = await db
    .select({ id: products.id, name: products.name, variant: products.variant, unit: products.unit, categoryName: categories.name })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(inArray(products.id, ids));
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const { lineTotals } = computeTotals(draft.lines, { kind: draft.discountKind, value: draft.discountValue });
  const lines = draft.lines.map((line, i) => {
    const { id: _, ...product } = byId.get(line.productId)!;
    return { ...line, ...product, lineTotal: lineTotals[i]! };
  });
  return { ...draft, lines };
}

/** Edits need no approval while the draft is open; each one is logged with the lines before and after. */
export async function updateDraft(db: Db, id: string, input: DraftInput, actor: Actor) {
  await db.transaction(async (tx) => {
    const draft = await lockOpen(tx, id);
    await applyEdit(tx, draft, await draftContent(tx, input), actor);
  });
  return getDraft(db, id);
}

/** Counts a print of "NOTA SEMENTARA, BUKAN BUKTI PEMBAYARAN". Once printed, cancelling needs approval. */
export async function printDraft(db: Db, id: string, actor: Actor) {
  await db.transaction(async (tx) => {
    const draft = await lockOpen(tx, id);
    const printCount = draft.printCount + 1;
    await tx.update(posDrafts).set({ printCount }).where(eq(posDrafts.id, id));
    await audit(tx, actor, {
      action: "pos.draft.print",
      entityId: id,
      summary: `Cetak ${draft.number} (cetakan ke-${printCount})`,
      after: { printCount },
    });
  });
  return getDraft(db, id);
}

/** A printed draft may already be in the customer's hand, so a non-admin cancels it only with approval. */
function cancelRequirement(draft: Draft, actor: Pick<Actor, "role">): Requirement | null {
  if (actor.role === "admin" || draft.printCount === 0) return null;
  return {
    kind: "cancel_printed_draft",
    subject: { draftId: draft.id, number: draft.number, total: draft.total, printCount: draft.printCount },
    summary: `Batal ${draft.number} · sudah dicetak ${draft.printCount}× · ${formatRupiah(draft.total)}`,
    message: "Nota sementara yang sudah dicetak hanya bisa dibatalkan dengan persetujuan admin.",
  };
}

export async function draftCancelApproval(db: Db, id: string, actor: Pick<Actor, "role">) {
  const [draft] = await db.select().from(posDrafts).where(eq(posDrafts.id, id));
  if (!draft) throw new DomainError("not_found", "Nota sementara tidak ditemukan");
  return cancelRequirement(draft, actor);
}

export async function cancelDraft(db: Db, id: string, { reason, approval }: z.output<typeof posDraftCancelInput>, actor: Actor) {
  const pinAdmin = await pinApprover(db, actor, approval);
  await db.transaction(async (tx) => {
    const draft = await lockOpen(tx, id);
    const approvalId = await authorize(tx, actor, cancelRequirement(draft, actor), approval, pinAdmin);
    await tx
      .update(posDrafts)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: actor.id, cancelReason: reason })
      .where(eq(posDrafts.id, id));
    await audit(tx, actor, {
      action: "pos.draft.cancel",
      entityId: id,
      summary: `Batal ${draft.number} ${formatRupiah(draft.total)}`,
      before: { status: "open" },
      after: { status: "cancelled", printCount: draft.printCount },
      reason,
      approvalId,
    });
  });
  return getDraft(db, id);
}

/**
 * Inside the payment's transaction, after the POS sale is written: the draft takes the paid
 * cart's content (an audited edit when the cashier changed it at the till) and becomes `paid`,
 * linked to the sale. A draft paid or cancelled meanwhile rolls the sale back.
 */
export async function settleDraft(tx: Db, id: string, sale: DraftInput & { id: string; number: string }, actor: Actor) {
  const draft = await lockOpen(tx, id);
  await applyEdit(tx, draft, await draftContent(tx, sale), actor);
  await tx.update(posDrafts).set({ status: "paid", saleId: sale.id }).where(eq(posDrafts.id, id));
  await audit(tx, actor, {
    action: "pos.draft.pay",
    entityId: id,
    summary: `${draft.number} dibayar dengan ${sale.number}`,
    before: { status: "open" },
    after: { status: "paid", saleId: sale.id },
  });
}
