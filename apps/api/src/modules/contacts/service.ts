import { DomainError, type contactInput, type contactQuery, type contactLookupQuery } from "@billy/core";
import { contacts, type Db } from "@billy/db";
import { and, asc, count, desc, eq, ilike, or } from "drizzle-orm";
import type { z } from "zod";
import { likePattern } from "../../lib/search.ts";

function filter(query: { q: string; kind?: z.output<typeof contactLookupQuery>["kind"] }) {
  return and(query.kind ? eq(contacts.kind, query.kind) : undefined, query.q ? or(ilike(contacts.name, likePattern(query.q)), ilike(contacts.code, likePattern(query.q))) : undefined);
}
export async function listContacts(db: Db, query: z.output<typeof contactQuery>) {
  const where = filter(query);
  const [rows, totals] = await Promise.all([
    db.select().from(contacts).where(where).orderBy(desc(contacts.active), asc(contacts.name)).limit(query.pageSize).offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(contacts).where(where),
  ]);
  return { rows, total: totals[0]?.total ?? 0 };
}
export async function lookupContacts(db: Db, query: z.output<typeof contactLookupQuery>) {
  return db.select({ id: contacts.id, code: contacts.code, name: contacts.name, paymentTermsDays: contacts.paymentTermsDays }).from(contacts).where(and(eq(contacts.active, true), filter(query))).orderBy(asc(contacts.name)).limit(30);
}
export async function getContact(db: Db, id: string) {
  const [row] = await db.select().from(contacts).where(eq(contacts.id, id));
  if (!row) throw new DomainError("not_found", "Kontak tidak ditemukan");
  return row;
}
export async function createContact(db: Db, input: z.output<typeof contactInput>) {
  return db.transaction(async (tx) => { const [row] = await tx.insert(contacts).values(input).returning(); return row; });
}
export async function updateContact(db: Db, id: string, input: z.output<typeof contactInput>) {
  return db.transaction(async (tx) => { const [row] = await tx.update(contacts).set(input).where(eq(contacts.id, id)).returning(); if (!row) throw new DomainError("not_found", "Kontak tidak ditemukan"); return row; });
}
