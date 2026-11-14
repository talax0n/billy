import {
  type currentShiftQuery,
  DomainError,
  formatRupiah,
  rupiah,
  type shiftCloseInput,
  type shiftOpenInput,
} from "@billy/core";
import { accounts, cashEntries, cashShifts, type Db, posSales } from "@billy/db";
import { and, eq, gte, isNull, lte, ne, notExists, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";
import type { Actor, SessionUser } from "../../env.ts";
import { audit } from "../../lib/audit.ts";
import { cashierOf, OFFLINE_AFTER_MS } from "../pos/service.ts";

type Shift = typeof cashShifts.$inferSelect;

/** What a kasir may see of a shift: never the expected cash or the difference. */
const openView = ({ id, deviceCode, accountId, openedAt, openingFloat }: Shift) => ({ id, deviceCode, accountId, openedAt, openingFloat });

/** A kasir reaches only their own shifts. */
const ownedBy = (actor: Pick<Actor, "id" | "role">) => (actor.role === "kasir" ? eq(cashShifts.cashierId, actor.id) : undefined);

const replaced = alias(posSales, "replaced");
const revisions = alias(posSales, "revisions");

const sum = (value: SQL) => sql`coalesce(sum(${value}), 0)::bigint`.mapWith((v) => rupiah(Number(v)));

/**
 * The cash that should be in the drawer at `closedAt`, from its parts:
 * - cash sales made under this shift. A revisi counts only its difference from the nota it
 *   replaced, the money that actually changed hands: plus when collected, minus when refunded;
 * - cash sales the shift's cashier voided while it was open, whichever shift sold them, since
 *   the refund came out of the drawer in front of them. A nota voided by a revisi is not a
 *   refund: its money stays where it was paid;
 * - every other movement on the drawer account while it was open (manual in or out, transfers,
 *   expenses, payments). Kasir sales and their voids are already counted above.
 * QRIS and transfer sales never touch the drawer.
 */
export async function cashTally(tx: Db, shift: Shift, closedAt: Date) {
  const [sales] = await tx
    .select({ total: sum(sql`${posSales.total} - coalesce(${replaced.total}, 0)`) })
    .from(posSales)
    .leftJoin(replaced, eq(replaced.id, posSales.revisionOf))
    .where(and(eq(posSales.shiftId, shift.id), eq(posSales.method, "cash")));
  const [voids] = await tx
    .select({ total: sum(sql`${posSales.total}`) })
    .from(posSales)
    .where(
      and(
        eq(posSales.method, "cash"),
        eq(posSales.voidedBy, shift.cashierId),
        gte(posSales.voidedAt, shift.openedAt),
        lte(posSales.voidedAt, closedAt),
        notExists(tx.select({ id: revisions.id }).from(revisions).where(eq(revisions.revisionOf, posSales.id))),
      ),
    );
  const [moved] = await tx
    .select({ total: sum(sql`case when ${cashEntries.direction} = 'in' then ${cashEntries.amount} else -${cashEntries.amount} end`) })
    .from(cashEntries)
    .where(
      and(
        eq(cashEntries.accountId, shift.accountId),
        ne(cashEntries.sourceType, "pos_sale"),
        gte(cashEntries.createdAt, shift.openedAt),
        lte(cashEntries.createdAt, closedAt),
      ),
    );
  const cashSales = sales!.total;
  const cashVoids = voids!.total;
  const cashMoved = moved!.total;
  return { cashSales, cashVoids, cashMoved, expectedCash: rupiah(shift.openingFloat + cashSales - cashVoids + cashMoved) };
}

/**
 * Idempotent by the device-generated id: a replay answers with the stored shift
 * (`created: false`). One open shift per cashier per device; the partial unique index
 * `cash_shifts_one_open` backs the check against a concurrent open.
 */
export async function openShift(db: Db, input: z.output<typeof shiftOpenInput>, actor: Actor) {
  return db.transaction(async (tx) => {
    const replay = async () => {
      const [shift] = await tx.select().from(cashShifts).where(and(eq(cashShifts.id, input.id), ownedBy(actor)));
      if (!shift) throw new DomainError("not_found", "Shift tidak ditemukan");
      return { created: false, shift: openView(shift) };
    };
    const [known] = await tx.select({ id: cashShifts.id }).from(cashShifts).where(eq(cashShifts.id, input.id));
    if (known) return replay();

    const cashierId = await cashierOf(tx, input.cashierId, actor);
    const [account] = await tx.select({ active: accounts.active }).from(accounts).where(eq(accounts.id, input.accountId));
    if (!account?.active) throw new DomainError("invalid", "Akun laci kasir tidak ditemukan atau nonaktif");
    const [open] = await tx
      .select({ id: cashShifts.id })
      .from(cashShifts)
      .where(and(eq(cashShifts.cashierId, cashierId), eq(cashShifts.deviceCode, input.deviceCode), isNull(cashShifts.closedAt)));
    if (open) throw new DomainError("conflict", `Masih ada shift terbuka di ${input.deviceCode}. Tutup shift itu dulu.`);

    const openedAt = new Date(input.openedAt);
    const [shift] = await tx
      .insert(cashShifts)
      .values({ id: input.id, cashierId, deviceCode: input.deviceCode, accountId: input.accountId, openedAt, openingFloat: input.openingFloat })
      .onConflictDoNothing({ target: cashShifts.id })
      .returning();
    if (!shift) return replay();
    await audit(tx, actor, {
      action: "shift.open",
      entityId: shift.id,
      summary: `Buka shift ${shift.deviceCode} · modal ${formatRupiah(shift.openingFloat)}`,
      after: { cashierId, deviceCode: shift.deviceCode, accountId: shift.accountId, openedAt: input.openedAt, openingFloat: shift.openingFloat },
      deviceCode: shift.deviceCode,
      ...(Date.now() - openedAt.getTime() > OFFLINE_AFTER_MS && { source: "kasir_offline" as const }),
    });
    return { created: true, shift: openView(shift) };
  });
}

/**
 * The blind close. The server computes the expected cash when the close arrives, stores it with
 * the count and the difference, and answers with neither: the cashier only learns the shift is
 * closed. A replay answers the same without recomputing.
 */
export async function closeShift(db: Db, id: string, input: z.output<typeof shiftCloseInput>, actor: Actor) {
  return db.transaction(async (tx) => {
    const [shift] = await tx
      .select()
      .from(cashShifts)
      .where(and(eq(cashShifts.id, id), ownedBy(actor)))
      .for("update");
    if (!shift) throw new DomainError("not_found", "Shift tidak ditemukan");
    if (shift.closedAt) return { id, closedAt: shift.closedAt };

    const closedAt = new Date(input.closedAt);
    if (closedAt < shift.openedAt) throw new DomainError("invalid", "Waktu tutup shift sebelum waktu buka");
    const tally = await cashTally(tx, shift, closedAt);
    const difference = rupiah(input.countedCash - tally.expectedCash);
    await tx
      .update(cashShifts)
      .set({ closedAt, countedCash: input.countedCash, expectedCash: tally.expectedCash, difference, closeNote: input.note })
      .where(eq(cashShifts.id, id));
    await audit(tx, actor, {
      action: "shift.close",
      entityId: id,
      summary: `Tutup shift ${shift.deviceCode} · selisih ${formatRupiah(difference)}`,
      before: { closedAt: null },
      after: { closedAt: input.closedAt, openingFloat: shift.openingFloat, ...tally, countedCash: input.countedCash, difference, closeNote: input.note },
      deviceCode: shift.deviceCode,
      ...(Date.now() - closedAt.getTime() > OFFLINE_AFTER_MS && { source: "kasir_offline" as const }),
    });
    return { id, closedAt };
  });
}

/** The signed-in cashier's open shift on the device, so a device that lost its own record picks it up again. */
export async function currentShift(db: Db, user: SessionUser, { deviceCode }: z.output<typeof currentShiftQuery>) {
  const [shift] = await db
    .select()
    .from(cashShifts)
    .where(and(eq(cashShifts.cashierId, user.id), eq(cashShifts.deviceCode, deviceCode), isNull(cashShifts.closedAt)));
  return { shift: shift ? openView(shift) : null };
}
