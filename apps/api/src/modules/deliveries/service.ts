import {
  businessDate,
  changedFields,
  type DeliveryAction,
  type deliveryCreateInput,
  type DeliveryDetailsInput,
  DomainError,
  type DriverInput,
  driverTurnOrder,
  type DriverUpdateInput,
  nextDeliveryStatus,
} from "@billy/core";
import { contacts, type Db, deliveries, drivers, posLines, posSales, products, salesInvoices, salesLines } from "@billy/db";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../env.ts";
import { audit, type AuditEntry } from "../../lib/audit.ts";

const iso = (column: unknown) => sql<string | null>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const lineSummary = (rows: { docId: string; qty: number; name: string; variant: string }[]) => {
  const byDoc = new Map<string, string[]>();
  for (const r of rows) byDoc.set(r.docId, [...(byDoc.get(r.docId) ?? []), `${r.qty}× ${[r.name, r.variant].filter(Boolean).join(" ")}`]);
  return byDoc;
};

/**
 * Antrian Antar in one read: everything waiting or on the way, what finished today, and the
 * drivers with their derived status and turn. Small by nature, so the page polls it.
 */
export async function getBoard(db: Db, now = new Date()) {
  const today = businessDate(now);
  const finishedAt = sql`coalesce(${deliveries.deliveredAt}, ${deliveries.cancelledAt})`;
  const rows = await db
    .select({
      id: deliveries.id,
      status: deliveries.status,
      customerName: deliveries.customerName,
      address: deliveries.address,
      phone: deliveries.phone,
      note: deliveries.note,
      posSaleId: deliveries.posSaleId,
      posSaleNumber: posSales.number,
      salesInvoiceId: deliveries.salesInvoiceId,
      salesInvoiceNumber: salesInvoices.number,
      driverId: deliveries.driverId,
      driverName: drivers.name,
      queuedAt: iso(deliveries.queuedAt),
      departedAt: iso(deliveries.departedAt),
      deliveredAt: iso(deliveries.deliveredAt),
      cancelledAt: iso(deliveries.cancelledAt),
      cancelReason: deliveries.cancelReason,
    })
    .from(deliveries)
    .leftJoin(posSales, eq(posSales.id, deliveries.posSaleId))
    .leftJoin(salesInvoices, eq(salesInvoices.id, deliveries.salesInvoiceId))
    .leftJoin(drivers, eq(drivers.id, deliveries.driverId))
    .where(
      or(
        inArray(deliveries.status, ["waiting", "on_the_way"]),
        sql`(${finishedAt} at time zone 'Asia/Jakarta')::date = ${today}`,
      ),
    )
    .orderBy(asc(deliveries.queuedAt), asc(deliveries.id));

  const saleIds = rows.flatMap((r) => (r.posSaleId ? [r.posSaleId] : []));
  const invoiceIds = rows.flatMap((r) => (r.salesInvoiceId ? [r.salesInvoiceId] : []));
  const [saleLines, invoiceLines, driverRows] = await Promise.all([
    saleIds.length
      ? db
          .select({ docId: posLines.saleId, qty: posLines.qty, name: products.name, variant: products.variant })
          .from(posLines)
          .innerJoin(products, eq(products.id, posLines.productId))
          .where(inArray(posLines.saleId, saleIds))
          .orderBy(asc(posLines.position))
      : [],
    invoiceIds.length
      ? db
          .select({ docId: salesLines.invoiceId, qty: salesLines.qty, name: products.name, variant: products.variant })
          .from(salesLines)
          .innerJoin(products, eq(products.id, salesLines.productId))
          .where(inArray(salesLines.invoiceId, invoiceIds))
          .orderBy(asc(salesLines.position))
      : [],
    db
      .select({
        id: drivers.id,
        name: drivers.name,
        phone: drivers.phone,
        active: drivers.active,
        busy: sql<boolean>`coalesce(bool_or(${deliveries.status} = 'on_the_way'), false)`,
        lastDeliveredAt: iso(sql`max(${deliveries.deliveredAt}) filter (where ${deliveries.status} = 'delivered')`),
      })
      .from(drivers)
      .leftJoin(deliveries, eq(deliveries.driverId, drivers.id))
      .groupBy(drivers.id)
      .orderBy(asc(drivers.name)),
  ]);

  const items = new Map([...lineSummary(saleLines), ...lineSummary(invoiceLines)]);
  const turns = driverTurnOrder(driverRows);
  return {
    now: now.toISOString(),
    deliveries: rows.map((r) => ({ ...r, items: items.get(r.posSaleId ?? r.salesInvoiceId ?? "") ?? [] })),
    drivers: driverRows.map((d) => ({ ...d, turn: turns.indexOf(d) + 1 || null })),
    nextDriverId: turns[0]?.id ?? null,
  };
}

/**
 * Puts goods in the queue. Called inside the transaction that records the nota or by
 * "Tambah antaran". A nota queues at most once (unique `pos_sale_id`), so a replay is a no-op.
 */
export async function queueDelivery(
  tx: Db,
  details: Required<DeliveryDetailsInput>,
  link: { posSaleId?: string; salesInvoiceId?: string; customerId?: string | null; queuedAt?: Date },
  actor: Actor,
  auditExtra: Pick<AuditEntry, "source" | "deviceCode"> = {},
) {
  let customerName = details.customerName;
  if (!customerName && link.customerId) {
    const [customer] = await tx.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, link.customerId));
    customerName = customer?.name ?? "";
  }
  const [row] = await tx
    .insert(deliveries)
    .values({
      ...details,
      customerName: customerName || "Pelanggan umum",
      posSaleId: link.posSaleId ?? null,
      salesInvoiceId: link.salesInvoiceId ?? null,
      ...(link.queuedAt && { queuedAt: link.queuedAt }),
      createdBy: actor.id,
    })
    .onConflictDoNothing({ target: deliveries.posSaleId })
    .returning({ id: deliveries.id, customerName: deliveries.customerName });
  if (!row) return null;
  await audit(tx, actor, {
    action: "delivery.create",
    entityId: row.id,
    summary: `Antar ke ${row.customerName} · ${details.address}`,
    after: { ...details, customerName: row.customerName, ...link },
    ...auditExtra,
  });
  return row;
}

export async function createDelivery(db: Db, input: z.output<typeof deliveryCreateInput>, actor: Actor) {
  const { invoiceNumber, ...details } = input;
  return db.transaction(async (tx) => {
    let invoice: { id: string; customerId: string } | undefined;
    if (invoiceNumber) {
      [invoice] = await tx
        .select({ id: salesInvoices.id, customerId: salesInvoices.customerId })
        .from(salesInvoices)
        .where(and(eq(salesInvoices.number, invoiceNumber), isNull(salesInvoices.voidedAt)));
      if (!invoice) throw new DomainError("invalid", `Faktur ${invoiceNumber} tidak ditemukan`);
    }
    const row = await queueDelivery(tx, details, { ...(invoice && { salesInvoiceId: invoice.id, customerId: invoice.customerId }) }, actor);
    return row!;
  });
}

async function move(
  db: Db,
  id: string,
  action: DeliveryAction,
  actor: Actor,
  patch: (tx: Db, current: { customerName: string; driverName: string | null }) => Promise<{ set: Partial<typeof deliveries.$inferInsert>; summary: string }>,
  reason?: string,
) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: deliveries.status, customerName: deliveries.customerName, driverId: deliveries.driverId })
      .from(deliveries)
      .where(eq(deliveries.id, id))
      .for("update");
    if (!current) throw new DomainError("not_found", "Antaran tidak ditemukan");
    const status = nextDeliveryStatus(current.status, action);
    const [driver] = current.driverId ? await tx.select({ name: drivers.name }).from(drivers).where(eq(drivers.id, current.driverId)) : [];
    const { set, summary } = await patch(tx, { customerName: current.customerName, driverName: driver?.name ?? null });
    await tx
      .update(deliveries)
      .set({ ...set, status })
      .where(eq(deliveries.id, id));
    await audit(tx, actor, {
      action: `delivery.${action}`,
      entityId: id,
      summary,
      before: { status: current.status, driverId: current.driverId },
      after: { status, ...("driverId" in set && { driverId: set.driverId }) },
      reason: reason ?? null,
    });
    return { id, status };
  });
}

export const departDelivery = (db: Db, id: string, driverId: string, actor: Actor) =>
  move(db, id, "depart", actor, async (tx, current) => {
    const [driver] = await tx.select({ name: drivers.name, active: drivers.active }).from(drivers).where(eq(drivers.id, driverId));
    if (!driver?.active) throw new DomainError("invalid", "Sopir tidak ditemukan atau sudah nonaktif");
    return { set: { driverId, departedAt: new Date() }, summary: `${driver.name} berangkat ke ${current.customerName}` };
  });

export const deliverDelivery = (db: Db, id: string, actor: Actor) =>
  move(db, id, "deliver", actor, async (_tx, current) => ({
    set: { deliveredAt: new Date() },
    summary: `Sampai di ${current.customerName}${current.driverName ? ` · ${current.driverName}` : ""}`,
  }));

/** Back to the queue without a driver. `queued_at` stays, so it keeps its place in line. */
export const requeueDelivery = (db: Db, id: string, actor: Actor) =>
  move(db, id, "requeue", actor, async (_tx, current) => ({
    set: { driverId: null, departedAt: null },
    summary: `Kembali ke antrian: ${current.customerName}${current.driverName ? ` (tadi dibawa ${current.driverName})` : ""}`,
  }));

export const cancelDelivery = (db: Db, id: string, reason: string, actor: Actor) =>
  move(
    db,
    id,
    "cancel",
    actor,
    async (_tx, current) => ({ set: { cancelledAt: new Date(), cancelReason: reason }, summary: `Antaran ${current.customerName} dibatalkan` }),
    reason,
  );

export async function createDriver(db: Db, input: Required<DriverInput>, actor: Actor) {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(drivers).values(input).returning();
    await audit(tx, actor, { action: "driver.create", entityId: row!.id, summary: `Sopir ${row!.name} ditambah`, after: input });
    return row!;
  });
}

export async function updateDriver(db: Db, id: string, input: Required<DriverUpdateInput>, actor: Actor) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select({ name: drivers.name, phone: drivers.phone, active: drivers.active }).from(drivers).where(eq(drivers.id, id)).for("update");
    if (!before) throw new DomainError("not_found", "Sopir tidak ditemukan");
    const [row] = await tx.update(drivers).set(input).where(eq(drivers.id, id)).returning();
    const diff = changedFields(before, input);
    if (diff) await audit(tx, actor, { action: "driver.update", entityId: id, summary: `Sopir ${row!.name} diubah`, ...diff });
    return row!;
  });
}
