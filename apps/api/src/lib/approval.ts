import {
  APPROVAL_TTL_MS,
  type ApprovalInput,
  type ApprovalKind,
  DomainError,
  PIN_LOCK_MS,
  PIN_MAX_ATTEMPTS,
} from "@billy/core";
import { approvals, auditEvents, type Db, users } from "@billy/db";
import { and, count, eq, gt, isNotNull, max, sql } from "drizzle-orm";
import { verifyPassword } from "../auth/password.ts";
import type { Actor } from "../env.ts";
import { audit } from "./audit.ts";

/** What an action needs approved, derived on the server from the action's own input. */
export interface Requirement {
  kind: ApprovalKind;
  /** Compared as jsonb with the approved subject; built by the same function for the request and the action. */
  subject: Record<string, unknown>;
  summary: string;
  /** Names the limit, e.g. "Diskon 8% melebihi batas kasir 5% per nota." */
  message: string;
  deviceCode?: string | null;
}

/** 403 for an action that needs an admin's approval it does not have. The body carries `approval`. */
export class ApprovalRequired extends DomainError {
  constructor(
    message: string,
    readonly approvalKind: ApprovalKind | null,
  ) {
    super("forbidden", message);
  }
}

const time = new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: "Asia/Jakarta" });

async function pinLockedUntil(db: Db, actorId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: max(auditEvents.at) })
    .from(auditEvents)
    .where(and(eq(auditEvents.actorId, actorId), eq(auditEvents.action, "approval.pin_locked")));
  const until = row?.at ? new Date(new Date(row.at).getTime() + PIN_LOCK_MS) : null;
  return until && until > new Date() ? until : null;
}

/** Wrong PINs since the last lock, the last PIN approval, or the lock window, whichever is latest. */
async function recentPinFailures(db: Db, actorId: string): Promise<number> {
  const [lock] = await db
    .select({ at: max(auditEvents.at) })
    .from(auditEvents)
    .where(and(eq(auditEvents.actorId, actorId), eq(auditEvents.action, "approval.pin_locked")));
  const [success] = await db
    .select({ at: max(approvals.createdAt) })
    .from(approvals)
    .where(and(eq(approvals.requestedBy, actorId), eq(approvals.method, "pin")));
  const since = new Date(
    Math.max(Date.now() - PIN_LOCK_MS, lock?.at ? new Date(lock.at).getTime() : 0, success?.at ? new Date(success.at).getTime() : 0),
  );
  const [row] = await db
    .select({ n: count() })
    .from(auditEvents)
    .where(and(eq(auditEvents.actorId, actorId), eq(auditEvents.action, "approval.pin_failed"), gt(auditEvents.at, since)));
  return row!.n;
}

/**
 * Checks a PIN typed on the Kasir screen against every active admin's PIN. Runs before the
 * action's transaction, so a wrong PIN stays logged although the action fails. Five wrong PINs
 * lock PIN approval for this user for 15 minutes. Returns the approving admin's id, or null
 * when no PIN was sent.
 */
export async function pinApprover(db: Db, actor: Actor, approval: ApprovalInput | undefined): Promise<string | null> {
  if (!approval || !("pin" in approval) || actor.role === "admin") return null;
  const locked = await pinLockedUntil(db, actor.id);
  if (locked) {
    throw new ApprovalRequired(`PIN admin dikunci sampai ${time.format(locked)} karena salah ${PIN_MAX_ATTEMPTS} kali. Minta persetujuan dari jauh.`, null);
  }
  const admins = await db
    .select({ id: users.id, hash: users.approvalPinHash })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.active, true), isNotNull(users.approvalPinHash)));
  if (admins.length === 0) {
    throw new ApprovalRequired("Belum ada admin yang mengatur PIN persetujuan. Minta persetujuan dari jauh.", null);
  }
  for (const admin of admins) {
    if (await verifyPassword(approval.pin, admin.hash!)) return admin.id;
  }
  await audit(db, actor, { action: "approval.pin_failed", entityId: actor.id, summary: "PIN admin salah" });
  const failures = await recentPinFailures(db, actor.id);
  if (failures >= PIN_MAX_ATTEMPTS) {
    await audit(db, actor, {
      action: "approval.pin_locked",
      entityId: actor.id,
      summary: `PIN admin dikunci 15 menit setelah salah ${PIN_MAX_ATTEMPTS} kali`,
    });
    throw new ApprovalRequired(`PIN admin salah ${PIN_MAX_ATTEMPTS} kali. PIN dikunci 15 menit; minta persetujuan dari jauh.`, null);
  }
  throw new ApprovalRequired(`PIN admin salah. Sisa ${PIN_MAX_ATTEMPTS - failures} percobaan.`, null);
}

/**
 * Inside the action's transaction: returns the approval id the action is logged with, or null
 * when the action needs none. A PIN approval is recorded here as already used. A remote one is
 * spent with one conditional update, so it is spent at most once and only on its own subject.
 */
export async function authorize(
  tx: Db,
  actor: Actor,
  requirement: Requirement | null,
  approval: ApprovalInput | undefined,
  pinAdminId: string | null,
): Promise<string | null> {
  if (!requirement) return null;
  const ask = `${requirement.message} Minta persetujuan admin.`;
  if (!approval) throw new ApprovalRequired(ask, requirement.kind);

  if ("pin" in approval) {
    if (!pinAdminId) throw new ApprovalRequired(ask, requirement.kind);
    const now = new Date();
    const [row] = await tx
      .insert(approvals)
      .values({
        kind: requirement.kind,
        status: "used",
        method: "pin",
        requestedBy: actor.id,
        deviceCode: requirement.deviceCode ?? null,
        subject: requirement.subject,
        summary: requirement.summary,
        decidedBy: pinAdminId,
        decidedAt: now,
        usedAt: now,
        expiresAt: now,
      })
      .returning({ id: approvals.id });
    return row!.id;
  }

  const [spent] = await tx
    .update(approvals)
    .set({ status: "used", usedAt: new Date() })
    .where(
      and(
        eq(approvals.id, approval.id),
        eq(approvals.requestedBy, actor.id),
        eq(approvals.status, "approved"),
        gt(approvals.expiresAt, new Date()),
        eq(approvals.kind, requirement.kind),
        sql`${approvals.subject} = ${JSON.stringify(requirement.subject)}::jsonb`,
      ),
    )
    .returning({ id: approvals.id });
  if (spent) return spent.id;
  throw new ApprovalRequired(await whyNotSpendable(tx, actor, approval.id), requirement.kind);
}

async function whyNotSpendable(tx: Db, actor: Actor, id: string): Promise<string> {
  const [row] = await tx
    .select({ status: approvals.status, requestedBy: approvals.requestedBy, expiresAt: approvals.expiresAt })
    .from(approvals)
    .where(eq(approvals.id, id));
  if (!row || row.requestedBy !== actor.id) return "Persetujuan tidak ditemukan.";
  if (row.status === "used") return "Persetujuan ini sudah dipakai.";
  if (row.status === "rejected") return "Permintaan persetujuan ditolak admin.";
  if (row.expiresAt <= new Date() || row.status === "expired") return "Persetujuan sudah kedaluwarsa. Minta persetujuan lagi.";
  if (row.status === "pending") return "Persetujuan belum diberikan admin.";
  return "Persetujuan ini untuk transaksi lain. Minta persetujuan baru.";
}

/** A pending remote request, valid for 10 minutes. */
export async function createRequest(tx: Db, actor: Actor, requirement: Requirement) {
  const [row] = await tx
    .insert(approvals)
    .values({
      kind: requirement.kind,
      status: "pending",
      method: "remote",
      requestedBy: actor.id,
      deviceCode: requirement.deviceCode ?? null,
      subject: requirement.subject,
      summary: requirement.summary,
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
    })
    .returning({ id: approvals.id });
  await audit(tx, actor, {
    action: "approval.request",
    entityId: row!.id,
    summary: `Minta persetujuan: ${requirement.summary}`,
    after: { kind: requirement.kind, subject: requirement.subject },
    approvalId: row!.id,
    deviceCode: requirement.deviceCode ?? null,
  });
  return row!.id;
}
