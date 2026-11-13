import {
  aboveNormal,
  addDays,
  BASIS_POINTS,
  type BusinessDate,
  businessDate,
  dayStart,
  formatBp,
  formatRupiah,
  median,
  type Rupiah,
  rupiah,
  WATCHDOG,
  type WatchdogFlag,
  type WatchdogSettings,
} from "@billy/core";
import {
  auditEvents,
  cashShifts,
  type Db,
  posDrafts,
  posLines,
  posSales,
  quotations,
  salesInvoices,
  salesLines,
  settings,
  stockOpnameLines,
  stockOpnames,
  users,
} from "@billy/db";
import { and, count, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, max, min, ne, or, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { getLimits } from "../pos/service.ts";
import { opnameSummary } from "../opname/service.ts";

interface Range {
  from: BusinessDate;
  to: BusinessDate;
}

export async function getWatchdogSettings(db: Db): Promise<WatchdogSettings> {
  const [row] = await db
    .select({
      cashDifferenceThreshold: settings.cashDifferenceThreshold,
      openTime: sql<string>`to_char(${settings.openTime}, 'HH24:MI')`,
      closeTime: sql<string>`to_char(${settings.closeTime}, 'HH24:MI')`,
    })
    .from(settings);
  return row ?? { cashDifferenceThreshold: rupiah(10_000), openTime: "07:00", closeTime: "17:00" };
}

/** Instants inside the business days of the range, as an index-friendly bound on a timestamptz. */
const within = (at: PgColumn, from: BusinessDate, to: BusinessDate) => and(gte(at, dayStart(from)), lt(at, dayStart(addDays(to, 1))));
const localDay = (at: PgColumn) => sql<string>`to_char(${at} at time zone 'Asia/Jakarta', 'YYYY-MM-DD')`;

const stamp = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Jakarta" });
const signed = (value: Rupiah) => `${value > 0 ? "+" : ""}${formatRupiah(value)}`;
const person = (id: string | null, name: string | null) => (name ? { id, name } : null);

const spikeNoun = { voids: "void", revisi: "revisi", refunds: "refund" } as const;

/** Voids, revisi and refunds per cashier per day, against that cashier's prior 30 days. Admin's own are not flagged. */
async function spikes(db: Db, { from, to }: Range): Promise<WatchdogFlag[]> {
  const day = localDay(auditEvents.at);
  const rows = await db
    .select({
      actorId: auditEvents.actorId,
      name: users.name,
      day,
      at: max(auditEvents.at),
      voids: sql<number>`count(*) filter (where ${auditEvents.action} = 'pos.sale.void')::int`,
      revisi: sql<number>`count(*) filter (where ${auditEvents.action} = 'pos.sale.revise')::int`,
      refunds: sql<number>`count(*) filter (where ${auditEvents.action} = 'pos.sale.revise' and (${auditEvents.after}->>'difference')::bigint < 0)::int`,
    })
    .from(auditEvents)
    .innerJoin(users, eq(users.id, auditEvents.actorId))
    .where(
      and(
        inArray(auditEvents.action, ["pos.sale.void", "pos.sale.revise"]),
        within(auditEvents.at, addDays(from, -WATCHDOG.spikeHistoryDays), to),
        ne(auditEvents.actorRole, "admin"),
      ),
    )
    .groupBy(auditEvents.actorId, users.name, day);

  const byDay = new Map(rows.map((r) => [`${r.actorId}|${r.day}`, r]));
  const flags: WatchdogFlag[] = [];
  for (const r of rows) {
    if (r.day < from || r.day > to) continue;
    for (const kind of ["voids", "revisi", "refunds"] as const) {
      const history = Array.from({ length: WATCHDOG.spikeHistoryDays }, (_, i) => byDay.get(`${r.actorId}|${addDays(r.day, -1 - i)}`)?.[kind] ?? 0);
      if (!aboveNormal(r[kind], history)) continue;
      flags.push({
        id: `${kind}:${r.actorId}:${r.day}`,
        type: kind,
        severity: kind === "revisi" ? "medium" : "high",
        who: person(r.actorId, r.name),
        at: r.at!.toISOString(),
        date: r.day,
        message: `${r[kind]} ${spikeNoun[kind]} dalam sehari, biasanya ${median(history).toLocaleString("id-ID")}`,
        target: { type: "audit", actorId: r.actorId, action: kind === "voids" ? "pos.sale.void" : "pos.sale.revise", date: r.day },
      });
    }
  }
  return flags;
}

async function shiftDifferences(db: Db, { from, to }: Range, threshold: Rupiah): Promise<WatchdogFlag[]> {
  const rows = await db
    .select({
      id: cashShifts.id,
      cashierId: cashShifts.cashierId,
      name: users.name,
      deviceCode: cashShifts.deviceCode,
      day: localDay(cashShifts.openedAt),
      closedAt: cashShifts.closedAt,
      expectedCash: cashShifts.expectedCash,
      countedCash: cashShifts.countedCash,
      difference: cashShifts.difference,
    })
    .from(cashShifts)
    .innerJoin(users, eq(users.id, cashShifts.cashierId))
    .where(and(within(cashShifts.openedAt, from, to), isNotNull(cashShifts.closedAt), sql`abs(${cashShifts.difference}) >= ${threshold}`));
  return rows.map((r) => ({
    id: `shift_difference:${r.id}`,
    type: "shift_difference",
    severity: r.difference! < 0 ? "high" : "medium",
    who: person(r.cashierId, r.name),
    at: r.closedAt!.toISOString(),
    date: r.day,
    message: `Selisih kas shift ${r.deviceCode} ${signed(r.difference!)}: seharusnya ${formatRupiah(r.expectedCash!)}, dihitung ${formatRupiah(r.countedCash!)}`,
    target: { type: "shift", cashierId: r.cashierId, date: r.day },
  }));
}

/** Discount in basis points of the gross, rounded up like `combinedDiscountBp`. */
const discountBp = (gross: number, net: number) => (gross > 0 ? Math.ceil(((gross - net) * BASIS_POINTS) / gross) : 0);

/**
 * Non-voided Kasir sales and fakturs by anyone but admin with a line under qty × its cost
 * snapshot, or a discount at or within 0,5% of the cap. A faktur that came from a penawaran
 * names the quote.
 */
async function pricing(db: Db, { from, to }: Range, maxBp: number): Promise<WatchdogFlag[]> {
  const nearCap = (bp: number) => bp > 0 && bp >= maxBp - WATCHDOG.discountNearCapBp;
  const posGross = sql<number>`sum(${posLines.qty} * ${posLines.unitPrice})`.mapWith(Number);
  const posBelow = sql<number>`count(*) filter (where ${posLines.lineTotal} < ${posLines.qty} * ${posLines.unitCost})`.mapWith(Number);
  const invoiceGross = sql<number>`sum(${salesLines.qty} * ${salesLines.unitPrice})`.mapWith(Number);
  const invoiceBelow = sql<number>`count(*) filter (where ${salesLines.lineTotal} < ${salesLines.qty} * ${salesLines.unitCost})`.mapWith(Number);
  const invoiceNet = sql<number>`${salesInvoices.subtotal} - ${salesInvoices.discountAmount}`.mapWith(Number);
  const [sales, invoices] = await Promise.all([
    db
      .select({
        id: posSales.id,
        number: posSales.number,
        at: posSales.soldAt,
        date: posSales.date,
        net: posSales.total,
        gross: posGross,
        below: posBelow,
        whoId: users.id,
        name: users.name,
      })
      .from(posSales)
      .innerJoin(posLines, eq(posLines.saleId, posSales.id))
      .innerJoin(users, eq(users.id, posSales.cashierId))
      .where(and(gte(posSales.date, from), lte(posSales.date, to), isNull(posSales.voidedAt), ne(users.role, "admin")))
      .groupBy(posSales.id, users.id)
      .having(or(gt(posBelow, 0), sql`${posGross} > ${posSales.total}`)),
    db
      .select({
        id: salesInvoices.id,
        number: salesInvoices.number,
        quoteNumber: quotations.number,
        at: salesInvoices.createdAt,
        date: salesInvoices.date,
        net: invoiceNet,
        gross: invoiceGross,
        below: invoiceBelow,
        whoId: users.id,
        name: users.name,
      })
      .from(salesInvoices)
      .innerJoin(salesLines, eq(salesLines.invoiceId, salesInvoices.id))
      .innerJoin(users, eq(users.id, salesInvoices.createdBy))
      .leftJoin(quotations, eq(quotations.invoiceId, salesInvoices.id))
      .where(and(gte(salesInvoices.date, from), lte(salesInvoices.date, to), isNull(salesInvoices.voidedAt), ne(users.role, "admin")))
      .groupBy(salesInvoices.id, users.id, quotations.id)
      .having(or(gt(invoiceBelow, 0), sql`${invoiceGross} > ${invoiceNet}`)),
  ]);

  const flags: WatchdogFlag[] = [];
  const documents = [
    ...sales.map((s) => ({ ...s, label: `Struk ${s.number}`, target: { type: "pos_sale" as const, id: s.id } })),
    ...invoices.map((i) => ({
      ...i,
      label: i.quoteNumber ? `Penawaran ${i.quoteNumber} → faktur ${i.number}` : `Faktur ${i.number}`,
      target: { type: "sales_invoice" as const, id: i.id },
    })),
  ];
  for (const d of documents) {
    const common = { who: person(d.whoId, d.name), at: d.at.toISOString(), date: d.date, target: d.target };
    if (d.below > 0) {
      flags.push({ ...common, id: `below_cost:${d.id}`, type: "below_cost", severity: "high", message: `${d.label} di bawah modal (${d.below} baris)` });
    }
    const bp = discountBp(d.gross, d.net);
    if (nearCap(bp)) {
      flags.push({
        ...common,
        id: `discount_near_cap:${d.id}`,
        type: "discount_near_cap",
        severity: bp > maxBp ? "high" : "medium",
        message: `${d.label}: diskon ${formatBp(bp)}${bp > maxBp ? " melebihi" : ", batas"} ${formatBp(maxBp)}`,
      });
    }
  }
  return flags;
}

/** Nota sementara left open after the business day closed, or cancelled once printed. Admin's own cancels are not flagged. */
async function drafts(db: Db, { from, to }: Range, closeTime: string, now: Date): Promise<WatchdogFlag[]> {
  const today = businessDate(now);
  const closedToday = clock.format(now) >= closeTime;
  const [open, cancelled] = await Promise.all([
    db
      .select({ id: posDrafts.id, number: posDrafts.number, date: posDrafts.date, at: posDrafts.createdAt, whoId: users.id, name: users.name })
      .from(posDrafts)
      .innerJoin(users, eq(users.id, posDrafts.createdBy))
      .where(and(eq(posDrafts.status, "open"), gte(posDrafts.date, from), lte(posDrafts.date, to))),
    db
      .select({
        id: posDrafts.id,
        number: posDrafts.number,
        printCount: posDrafts.printCount,
        at: posDrafts.cancelledAt,
        day: localDay(posDrafts.cancelledAt),
        whoId: users.id,
        name: users.name,
      })
      .from(posDrafts)
      .innerJoin(users, eq(users.id, posDrafts.cancelledBy))
      .where(and(eq(posDrafts.status, "cancelled"), gt(posDrafts.printCount, 0), within(posDrafts.cancelledAt, from, to), ne(users.role, "admin"))),
  ]);
  return [
    ...open
      .filter((d) => d.date < today || (d.date === today && closedToday))
      .map(
        (d): WatchdogFlag => ({
          id: `draft_open_after_close:${d.id}`,
          type: "draft_open_after_close",
          severity: "medium",
          who: person(d.whoId, d.name),
          at: d.at.toISOString(),
          date: d.date,
          message: `Nota sementara ${d.number} masih terbuka setelah jam tutup ${closeTime}`,
          target: { type: "audit", actorId: d.whoId, action: "pos.draft.create", date: d.date },
        }),
      ),
    ...cancelled.map(
      (d): WatchdogFlag => ({
        id: `draft_cancelled_printed:${d.id}`,
        type: "draft_cancelled_printed",
        severity: "high",
        who: person(d.whoId, d.name),
        at: d.at!.toISOString(),
        date: d.day,
        message: `Nota sementara ${d.number} dibatalkan setelah dicetak ${d.printCount}×`,
        target: { type: "audit", actorId: d.whoId, action: "pos.draft.cancel", date: d.day },
      }),
    ),
  ];
}

/** One flag per person per day with any logged activity outside opening hours. Imports (source system) do not count. */
async function outsideHours(db: Db, { from, to }: Range, { openTime, closeTime }: WatchdogSettings): Promise<WatchdogFlag[]> {
  const local = sql`(${auditEvents.at} at time zone 'Asia/Jakarta')::time`;
  const day = localDay(auditEvents.at);
  const rows = await db
    .select({ actorId: auditEvents.actorId, name: users.name, day, n: count(), first: min(auditEvents.at), last: max(auditEvents.at) })
    .from(auditEvents)
    .innerJoin(users, eq(users.id, auditEvents.actorId))
    .where(
      and(
        within(auditEvents.at, from, to),
        ne(auditEvents.source, "system"),
        or(sql`${local} < ${openTime}::time`, sql`${local} >= ${closeTime}::time`),
      ),
    )
    .groupBy(auditEvents.actorId, users.name, day);
  return rows.map((r) => {
    const span = r.n > 1 ? `${clock.format(r.first!)}–${clock.format(r.last!)}` : clock.format(r.first!);
    return {
      id: `outside_hours:${r.actorId}:${r.day}`,
      type: "outside_hours",
      severity: "medium",
      who: person(r.actorId, r.name),
      at: r.last!.toISOString(),
      date: r.day,
      message: `${r.n} aktivitas di luar jam buka ${openTime}–${closeTime} (${span})`,
      target: { type: "audit", actorId: r.actorId, action: null, date: r.day },
    };
  });
}

/** Three or more failed logins for one username on one day, and every PIN lockout. */
async function logins(db: Db, { from, to }: Range): Promise<WatchdogFlag[]> {
  const day = localDay(auditEvents.at);
  const [failed, locked] = await Promise.all([
    db
      .select({ entityId: auditEvents.entityId, actorId: auditEvents.actorId, name: users.name, day, n: count(), at: max(auditEvents.at) })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .where(and(eq(auditEvents.action, "auth.login_failed"), within(auditEvents.at, from, to)))
      .groupBy(auditEvents.entityId, auditEvents.actorId, users.name, day)
      .having(sql`count(*) >= ${WATCHDOG.failedLoginsPerDay}`),
    db
      .select({ id: auditEvents.id, actorId: auditEvents.actorId, name: users.name, day, at: auditEvents.at })
      .from(auditEvents)
      .innerJoin(users, eq(users.id, auditEvents.actorId))
      .where(and(eq(auditEvents.action, "approval.pin_locked"), within(auditEvents.at, from, to))),
  ]);
  return [
    ...failed.map(
      (r): WatchdogFlag => ({
        id: `failed_logins:${r.entityId}:${r.day}`,
        type: "failed_logins",
        severity: "medium",
        who: person(r.actorId, r.name ?? r.entityId),
        at: r.at!.toISOString(),
        date: r.day,
        message: r.actorId ? `${r.n} kali gagal masuk` : `${r.n} kali gagal masuk dengan nama pengguna tidak dikenal "${r.entityId}"`,
        target: { type: "audit", actorId: r.actorId, action: "auth.login_failed", date: r.day },
      }),
    ),
    ...locked.map(
      (r): WatchdogFlag => ({
        id: `pin_lockout:${r.id}`,
        type: "pin_lockout",
        severity: "high",
        who: person(r.actorId, r.name),
        at: r.at.toISOString(),
        date: r.day,
        message: "PIN admin dikunci 15 menit setelah salah 5 kali",
        target: { type: "audit", actorId: r.actorId, action: "approval.pin_failed", date: r.day },
      }),
    ),
  ];
}

/**
 * Signs of a device clock set wrong on purpose: a Kasir sale or shift timed more than 5
 * minutes after the server received it (the server never receives the future), and a shift
 * opened before the same cashier's previous shift on that device closed. One cashier's
 * events leave a device in order, so their receive order is their real order.
 */
async function clockTampering(db: Db, { from, to }: Range): Promise<WatchdogFlag[]> {
  const ahead = sql`make_interval(secs => ${WATCHDOG.clockAheadMs / 1000})`;
  const [sales, shifts] = await Promise.all([
    db
      .select({
        id: posSales.id,
        number: posSales.number,
        deviceCode: posSales.deviceCode,
        soldAt: posSales.soldAt,
        createdAt: posSales.createdAt,
        whoId: users.id,
        name: users.name,
      })
      .from(posSales)
      .innerJoin(users, eq(users.id, posSales.cashierId))
      // A sale dated ahead has a business date on or after the day it arrived.
      .where(and(gte(posSales.date, from), within(posSales.createdAt, from, to), sql`${posSales.soldAt} > ${posSales.createdAt} + ${ahead}`)),
    db
      .select({
        id: cashShifts.id,
        cashierId: cashShifts.cashierId,
        name: users.name,
        deviceCode: cashShifts.deviceCode,
        openedAt: cashShifts.openedAt,
        closedAt: cashShifts.closedAt,
        receivedAt: auditEvents.at,
      })
      .from(auditEvents)
      .innerJoin(cashShifts, sql`${cashShifts.id}::text = ${auditEvents.entityId}`)
      .innerJoin(users, eq(users.id, cashShifts.cashierId))
      .where(and(eq(auditEvents.action, "shift.open"), within(auditEvents.at, addDays(from, -WATCHDOG.spikeHistoryDays), to)))
      .orderBy(auditEvents.at),
  ]);

  const flags: WatchdogFlag[] = sales.map((s) => {
    const date = businessDate(s.createdAt);
    return {
      id: `clock_tampering:${s.id}`,
      type: "clock_tampering",
      severity: "high",
      who: person(s.whoId, s.name),
      at: s.createdAt.toISOString(),
      date,
      message: `Struk ${s.number} bertanggal ${stamp.format(s.soldAt)}, diterima server ${stamp.format(s.createdAt)}: jam ${s.deviceCode} terlalu cepat`,
      target: { type: "pos_sale", id: s.id },
    };
  });
  const [start, end] = [dayStart(from), dayStart(addDays(to, 1))];
  const previous = new Map<string, (typeof shifts)[number]>();
  for (const s of shifts) {
    const key = `${s.cashierId}|${s.deviceCode}`;
    const prev = previous.get(key);
    previous.set(key, s);
    if (s.receivedAt < start || s.receivedAt >= end) continue;
    const date = businessDate(s.receivedAt);
    const flag = (message: string): WatchdogFlag => ({
      id: `clock_tampering:${s.id}`,
      type: "clock_tampering",
      severity: "high",
      who: person(s.cashierId, s.name),
      at: s.receivedAt.toISOString(),
      date,
      message,
      target: { type: "shift", cashierId: s.cashierId, date },
    });
    if (s.openedAt.getTime() - s.receivedAt.getTime() > WATCHDOG.clockAheadMs) {
      flags.push(flag(`Shift ${s.deviceCode} dibuka ${stamp.format(s.openedAt)}, diterima server ${stamp.format(s.receivedAt)}: jam perangkat terlalu cepat`));
    } else if (prev?.closedAt && s.openedAt < prev.closedAt) {
      flags.push(flag(`Shift ${s.deviceCode} dibuka ${stamp.format(s.openedAt)}, sebelum shift sebelumnya ditutup ${stamp.format(prev.closedAt)}: jam perangkat mundur`));
    }
  }
  return flags;
}

/** Posted opnames whose differences add up to Rp 100.000 or more at cost, ignoring sign. */
async function opnames(db: Db, { from, to }: Range): Promise<WatchdogFlag[]> {
  const delta = sql`(${stockOpnameLines.countedQty} - ${stockOpnameLines.systemQty})`;
  const spread = sql<number>`sum(abs(${delta}) * ${stockOpnameLines.unitCost})`.mapWith(Number);
  const rows = await db
    .select({
      id: stockOpnames.id,
      number: stockOpnames.number,
      at: stockOpnames.postedAt,
      day: localDay(stockOpnames.postedAt),
      whoId: users.id,
      name: users.name,
      changed: sql<number>`count(*) filter (where ${delta} <> 0)`.mapWith(Number),
      net: sql<number>`sum(${delta} * ${stockOpnameLines.unitCost})`.mapWith(Number),
    })
    .from(stockOpnames)
    .innerJoin(stockOpnameLines, eq(stockOpnameLines.opnameId, stockOpnames.id))
    .innerJoin(users, eq(users.id, stockOpnames.postedBy))
    .where(and(eq(stockOpnames.status, "posted"), within(stockOpnames.postedAt, from, to)))
    .groupBy(stockOpnames.id, users.id)
    .having(sql`${spread} >= ${WATCHDOG.opnameDifferenceValue}`);
  return rows.map((r) => ({
    id: `opname_difference:${r.id}`,
    type: "opname_difference",
    severity: r.net < 0 ? "high" : "medium",
    who: person(r.whoId, r.name),
    at: r.at!.toISOString(),
    date: r.day,
    message: opnameSummary(r.number, r.changed, rupiah(r.net)),
    target: { type: "opname", id: r.id },
  }));
}

/** Every red flag in the range, newest first. Computed on read from the tables the flags are about. */
export async function watchdogFlags(db: Db, range: Range, now = new Date()): Promise<WatchdogFlag[]> {
  const [limits, watch] = await Promise.all([getLimits(db), getWatchdogSettings(db)]);
  const groups = await Promise.all([
    spikes(db, range),
    shiftDifferences(db, range, watch.cashDifferenceThreshold),
    pricing(db, range, limits.kasirMaxDiscountBp),
    drafts(db, range, watch.closeTime, now),
    outsideHours(db, range, watch),
    logins(db, range),
    clockTampering(db, range),
    opnames(db, range),
  ]);
  return groups.flat().sort((a, b) => b.at.localeCompare(a.at));
}

const total = (value: SQL, where?: SQL) =>
  sql`coalesce(sum(${value})${where ? sql` filter (where ${where})` : sql``}, 0)`.mapWith((v) => rupiah(Number(v)));

/**
 * Ringkasan harian: the day's flags and, per person, the day's voids, revisi, refunds,
 * discounts given and shift cash differences.
 */
export async function dailySummary(db: Db, date: BusinessDate) {
  const posDiscount = sql`${posSales.discountAmount} + coalesce((select sum(${posLines.discountAmount}) from ${posLines} where ${posLines.saleId} = ${posSales.id}), 0)`;
  const invoiceDiscount = sql`${salesInvoices.discountAmount} + coalesce((select sum(${salesLines.discountAmount}) from ${salesLines} where ${salesLines.invoiceId} = ${salesInvoices.id}), 0)`;
  const isVoid = sql`${auditEvents.action} = 'pos.sale.void'`;
  const isRefund = sql`(${auditEvents.action} = 'pos.sale.revise' and (${auditEvents.after}->>'difference')::bigint < 0)`;
  const [flags, events, pos, invoices, shifts] = await Promise.all([
    watchdogFlags(db, { from: date, to: date }),
    db
      .select({
        userId: auditEvents.actorId,
        voids: sql<number>`count(*) filter (where ${isVoid})`.mapWith(Number),
        voidAmount: total(sql`(${auditEvents.after}->>'total')::bigint`, isVoid),
        revisi: sql<number>`count(*) filter (where ${auditEvents.action} = 'pos.sale.revise')`.mapWith(Number),
        refunds: sql<number>`count(*) filter (where ${isRefund})`.mapWith(Number),
        refundAmount: total(sql`-(${auditEvents.after}->>'difference')::bigint`, isRefund),
      })
      .from(auditEvents)
      .where(and(inArray(auditEvents.action, ["pos.sale.void", "pos.sale.revise"]), within(auditEvents.at, date, date), isNotNull(auditEvents.actorId)))
      .groupBy(auditEvents.actorId),
    db
      .select({ userId: posSales.cashierId, discountAmount: total(posDiscount) })
      .from(posSales)
      .where(and(eq(posSales.date, date), isNull(posSales.voidedAt)))
      .groupBy(posSales.cashierId),
    db
      .select({ userId: salesInvoices.createdBy, discountAmount: total(invoiceDiscount) })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.date, date), isNull(salesInvoices.voidedAt)))
      .groupBy(salesInvoices.createdBy),
    db
      .select({ userId: cashShifts.cashierId, shifts: count(), shiftDifference: total(sql`${cashShifts.difference}`) })
      .from(cashShifts)
      .where(and(within(cashShifts.openedAt, date, date), isNotNull(cashShifts.closedAt)))
      .groupBy(cashShifts.cashierId),
  ]);

  const empty = {
    voids: 0,
    voidAmount: rupiah(0),
    revisi: 0,
    refunds: 0,
    refundAmount: rupiah(0),
    discountAmount: rupiah(0),
    shifts: 0,
    shiftDifference: rupiah(0),
  };
  const byUser = new Map<string, typeof empty>();
  const merge = (userId: string | null, values: Partial<typeof empty>) => {
    if (!userId) return;
    const row = byUser.get(userId) ?? { ...empty };
    for (const [key, value] of Object.entries(values) as [keyof typeof empty, number][]) row[key] = (row[key] + value) as never;
    byUser.set(userId, row);
  };
  for (const { userId, ...values } of [...events, ...pos, ...invoices, ...shifts]) merge(userId, values);

  const people = byUser.size
    ? await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(inArray(users.id, [...byUser.keys()]))
    : [];
  const rows = people
    .map((p) => ({ ...p, ...byUser.get(p.id)! }))
    .filter((r) => r.voids || r.revisi || r.refunds || r.discountAmount || r.shifts)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { date, flags, rows, total: rows.length };
}
