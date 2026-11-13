import type { auditQuery } from "@billy/core";
import { approvals, auditEvents, type Db, users } from "@billy/db";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";
import { matchAllTerms } from "../../lib/search.ts";

const approver = alias(users, "approver");
const day = sql`(${auditEvents.at} at time zone 'Asia/Jakarta')::date`;

/** Log Aktivitas: newest first, filtered by person, action, business date and words in the summary. */
export async function listAuditEvents(db: Db, query: z.output<typeof auditQuery>) {
  const where = and(
    query.actorId ? eq(auditEvents.actorId, query.actorId) : undefined,
    query.action ? eq(auditEvents.action, query.action) : undefined,
    query.from ? sql`${day} >= ${query.from}` : undefined,
    query.to ? sql`${day} <= ${query.to}` : undefined,
    matchAllTerms(sql`${auditEvents.summary}`, query.q),
  );
  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: auditEvents.id,
        at: auditEvents.at,
        actorId: auditEvents.actorId,
        actorName: users.name,
        actorRole: auditEvents.actorRole,
        source: auditEvents.source,
        deviceCode: auditEvents.deviceCode,
        action: auditEvents.action,
        entityType: auditEvents.entityType,
        entityId: auditEvents.entityId,
        summary: auditEvents.summary,
        before: auditEvents.before,
        after: auditEvents.after,
        reason: auditEvents.reason,
        approval: {
          id: approvals.id,
          kind: approvals.kind,
          method: approvals.method,
          approverName: approver.name,
        },
      })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .leftJoin(approvals, eq(approvals.id, auditEvents.approvalId))
      .leftJoin(approver, eq(approver.id, approvals.decidedBy))
      .where(where)
      .orderBy(desc(auditEvents.at), desc(auditEvents.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(auditEvents).where(where),
  ]);
  return { rows, total: counted!.total };
}
