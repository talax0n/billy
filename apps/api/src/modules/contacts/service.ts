import {
  contactCodePrefix,
  type ContactKind,
  type contactInput,
  type contactLookupQuery,
  type contactQuery,
  changedFields,
  DomainError,
  nextContactCode,
} from "@billy/core";
import { contacts, type Db } from "@billy/db";
import { and, asc, count, desc, eq, like, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../env.ts";
import { audit } from "../../lib/audit.ts";
import { matchAllTerms } from "../../lib/search.ts";

/** Optional kind, and every whitespace-separated term in the name, code or phone. */
function contactWhere(q: string, kind: ContactKind | undefined): SQL | undefined {
  const haystack = sql`${contacts.name} || ' ' || ${contacts.code} || ' ' || ${contacts.phone}`;
  return and(kind && eq(contacts.kind, kind), matchAllTerms(haystack, q));
}

export async function listContacts(db: Db, { q, kind, page, pageSize }: z.output<typeof contactQuery>) {
  const where = contactWhere(q, kind);
  const [rows, [counted]] = await Promise.all([
    db
      .select()
      .from(contacts)
      .where(where)
      .orderBy(desc(contacts.active), asc(contacts.name))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(contacts).where(where),
  ]);
  return { rows, total: counted!.total };
}

/** Active contacts for pickers in other modules (invoice customer, purchase supplier). */
export async function lookupContacts(db: Db, { q, kind }: z.output<typeof contactLookupQuery>) {
  return db
    .select({ id: contacts.id, code: contacts.code, name: contacts.name, paymentTermsDays: contacts.paymentTermsDays })
    .from(contacts)
    .where(and(eq(contacts.active, true), contactWhere(q, kind)))
    .orderBy(asc(contacts.name))
    .limit(20);
}

export async function suggestContactCode(db: Db, kind: ContactKind) {
  const rows = await db
    .select({ code: contacts.code })
    .from(contacts)
    .where(like(contacts.code, `${contactCodePrefix[kind]}-%`));
  return { code: nextContactCode(kind, rows.map((row) => row.code)) };
}

export async function getContact(db: Db, id: string) {
  const [row] = await db.select().from(contacts).where(eq(contacts.id, id));
  if (!row) throw new DomainError("not_found", "Kontak tidak ditemukan");
  return row;
}

export async function createContact(db: Db, input: z.output<typeof contactInput>, actor: Actor) {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(contacts).values(input).returning();
    await audit(tx, actor, { action: "contact.create", entityId: row!.id, summary: `Kontak ${row!.code} ${row!.name}`, after: input });
    return row!;
  });
}

export async function updateContact(db: Db, id: string, input: z.output<typeof contactInput>, actor: Actor) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(contacts).where(eq(contacts.id, id)).for("update");
    if (!before) throw new DomainError("not_found", "Kontak tidak ditemukan");
    const [row] = await tx.update(contacts).set(input).where(eq(contacts.id, id)).returning();
    const { createdAt: _c, updatedAt: _u, id: _id, ...fields } = before;
    const diff = changedFields(fields, { ...fields, ...input });
    if (diff) await audit(tx, actor, { action: "contact.update", entityId: id, summary: `Kontak ${row!.code} ${row!.name} diubah`, ...diff });
    return row!;
  });
}
