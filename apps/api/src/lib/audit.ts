import { type AuditAction, auditActions, type AuditSource } from "@billy/core";
import { auditEvents, type Db } from "@billy/db";
import type { Actor } from "../env.ts";

export interface AuditEntry {
  action: AuditAction;
  entityId: string;
  /** One readable line, e.g. "Pembatalan K1-261113-0410 Rp 210.000". */
  summary: string;
  /** Changed fields only. */
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  approvalId?: string | null;
  deviceCode?: string | null;
  /** Overrides the actor's source, e.g. `kasir_offline` for a sale synced late. */
  source?: AuditSource;
}

/**
 * Appends one audit event. Call it with the transaction that makes the change, so the change
 * and its log row commit together or not at all.
 */
export async function audit(tx: Db, actor: Actor | null, entry: AuditEntry): Promise<void> {
  await tx.insert(auditEvents).values({
    actorId: actor?.id ?? null,
    actorRole: actor?.role ?? null,
    source: entry.source ?? actor?.source ?? "web",
    deviceCode: entry.deviceCode ?? null,
    action: entry.action,
    entityType: auditActions[entry.action].entity,
    entityId: entry.entityId,
    summary: entry.summary,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
    approvalId: entry.approvalId ?? null,
  });
}

/** The legacy importer and other scripts: acts as the given admin, logged with source `system`. */
export const systemActor = (adminId: string): Actor => ({ id: adminId, role: "admin", source: "system" });
