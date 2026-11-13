import { type ApprovalPinInput, type approvalRequestInput, type ApprovalStatus, DomainError } from "@billy/core";
import { approvals, type Db, users } from "@billy/db";
import { and, asc, eq, gt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";
import { hashPassword, verifyPassword } from "../../auth/password.ts";
import type { Actor } from "../../env.ts";
import { createRequest, type Requirement } from "../../lib/approval.ts";
import { audit } from "../../lib/audit.ts";
import { posSaleApproval, posVoidApproval } from "../pos/service.ts";
import { invoiceApproval } from "../sales/service.ts";

type RequestInput = z.output<typeof approvalRequestInput>;

const requester = alias(users, "requester");
const decider = alias(users, "decider");

/** An unspent request past its deadline reads as expired; nothing needs to rewrite the row. */
const liveStatus = (status: ApprovalStatus, expiresAt: Date): ApprovalStatus =>
  (status === "pending" || status === "approved") && expiresAt <= new Date() ? "expired" : status;

function selectApprovals(db: Db) {
  return db
    .select({
      id: approvals.id,
      kind: approvals.kind,
      status: approvals.status,
      method: approvals.method,
      summary: approvals.summary,
      deviceCode: approvals.deviceCode,
      requestedBy: approvals.requestedBy,
      requestedByName: requester.name,
      decidedByName: decider.name,
      decidedAt: approvals.decidedAt,
      createdAt: approvals.createdAt,
      expiresAt: approvals.expiresAt,
    })
    .from(approvals)
    .innerJoin(requester, eq(requester.id, approvals.requestedBy))
    .leftJoin(decider, eq(decider.id, approvals.decidedBy));
}

type ApprovalRow = Awaited<ReturnType<typeof selectApprovals>>[number];
const view = ({ requestedBy: _r, ...row }: ApprovalRow) => ({ ...row, status: liveStatus(row.status, row.expiresAt) });

/** The subject of a request comes from the action's own rules, so the action later compares equal. */
async function requirementOf(db: Db, input: RequestInput, actor: Actor): Promise<Requirement | null> {
  switch (input.action) {
    case "pos.sale":
      return posSaleApproval(db, input.sale, actor);
    case "pos.void":
      return posVoidApproval(db, input.saleId, actor);
    case "sales.invoice":
      return invoiceApproval(db, input.invoice, actor);
  }
}

export async function requestApproval(db: Db, input: RequestInput, actor: Actor) {
  const source = input.action.startsWith("pos.") ? "kasir" : actor.source;
  const id = await db.transaction(async (tx) => {
    const requirement = await requirementOf(tx, input, actor);
    if (!requirement) throw new DomainError("invalid", "Transaksi ini tidak butuh persetujuan admin");
    return createRequest(tx, { ...actor, source }, requirement);
  });
  return getApproval(db, id, actor);
}

/** The requester polls this while waiting; admin may read any. */
export async function getApproval(db: Db, id: string, viewer: Pick<Actor, "id" | "role">) {
  const [row] = await selectApprovals(db).where(eq(approvals.id, id));
  if (!row || (viewer.role !== "admin" && row.requestedBy !== viewer.id)) {
    throw new DomainError("not_found", "Permintaan persetujuan tidak ditemukan");
  }
  return view(row);
}

/** Remote requests still waiting for the admin, oldest first: the top of the bell. */
export async function listPending(db: Db) {
  const rows = await selectApprovals(db)
    .where(and(eq(approvals.status, "pending"), gt(approvals.expiresAt, new Date())))
    .orderBy(asc(approvals.createdAt));
  return { rows: rows.map(view), total: rows.length };
}

/** pending → approved or rejected, once, before it expires. */
export async function decide(db: Db, id: string, decision: "approve" | "reject", admin: Actor) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(approvals)
      .set({ status: decision === "approve" ? "approved" : "rejected", decidedBy: admin.id, decidedAt: new Date() })
      .where(and(eq(approvals.id, id), eq(approvals.status, "pending"), gt(approvals.expiresAt, new Date())))
      .returning({ summary: approvals.summary, kind: approvals.kind });
    if (!row) throw new DomainError("conflict", "Permintaan ini sudah diputuskan atau kedaluwarsa");
    await audit(tx, admin, {
      action: decision === "approve" ? "approval.approve" : "approval.reject",
      entityId: id,
      summary: `${decision === "approve" ? "Disetujui" : "Ditolak"}: ${row.summary}`,
      before: { status: "pending" },
      after: { status: decision === "approve" ? "approved" : "rejected" },
      approvalId: id,
    });
  });
  return getApproval(db, id, admin);
}

export async function hasPin(db: Db, adminId: string) {
  const [row] = await db.select({ hash: users.approvalPinHash }).from(users).where(eq(users.id, adminId));
  return { set: Boolean(row?.hash) };
}

/** The admin confirms with their password, so an unattended open session cannot set a PIN. */
export async function setPin(db: Db, { password, pin }: ApprovalPinInput, admin: Actor) {
  const [row] = await db.select({ passwordHash: users.passwordHash, approvalPinHash: users.approvalPinHash }).from(users).where(eq(users.id, admin.id));
  if (!row || !(await verifyPassword(password, row.passwordHash))) throw new DomainError("invalid", "Kata sandi salah");
  const approvalPinHash = await hashPassword(pin);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ approvalPinHash }).where(eq(users.id, admin.id));
    await audit(tx, admin, {
      action: "approval_pin.set",
      entityId: admin.id,
      summary: row.approvalPinHash ? "PIN persetujuan diganti" : "PIN persetujuan dibuat",
    });
  });
  return { set: true };
}
