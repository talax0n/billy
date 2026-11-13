import { changedFields, DomainError, type PaginationQuery, roleLabels, type userCreateInput, type userUpdateInput } from "@billy/core";
import { type Db, users } from "@billy/db";
import { asc, count, eq, ilike, or } from "drizzle-orm";
import type { z } from "zod";
import { hashPassword } from "../../auth/password.ts";
import { deleteUserSessions } from "../../auth/session.ts";
import type { Actor } from "../../env.ts";
import { audit } from "../../lib/audit.ts";
import { likePattern } from "../../lib/search.ts";

const publicColumns = {
  id: users.id,
  username: users.username,
  name: users.name,
  role: users.role,
  active: users.active,
  createdAt: users.createdAt,
};

export async function listUsers(db: Db, { q, page, pageSize }: PaginationQuery) {
  const where = q ? or(ilike(users.username, likePattern(q)), ilike(users.name, likePattern(q))) : undefined;
  const [rows, [counted]] = await Promise.all([
    db
      .select(publicColumns)
      .from(users)
      .where(where)
      .orderBy(asc(users.username))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(users).where(where),
  ]);
  return { rows, total: counted!.total };
}

export async function createUser(db: Db, input: z.output<typeof userCreateInput>, actor: Actor) {
  const { password, ...rest } = input;
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ ...rest, passwordHash })
      .returning(publicColumns);
    await audit(tx, actor, {
      action: "user.create",
      entityId: user!.id,
      summary: `Pengguna ${user!.username} (${roleLabels[user!.role]})`,
      after: { username: user!.username, name: user!.name, role: user!.role },
    });
    return user!;
  });
}

/** A role change, deactivation or new password is logged; the password itself never is. */
export async function updateUser(db: Db, actor: Actor, id: string, input: z.output<typeof userUpdateInput>) {
  const { password, ...rest } = input;
  if (id === actor.id && (!rest.active || rest.role !== "admin")) {
    throw new DomainError("conflict", "Anda tidak bisa menonaktifkan atau menurunkan peran akun sendiri");
  }
  const passwordHash = password ? await hashPassword(password) : null;
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ name: users.name, role: users.role, active: users.active })
      .from(users)
      .where(eq(users.id, id))
      .for("update");
    if (!before) throw new DomainError("not_found", "Pengguna tidak ditemukan");
    const [user] = await tx
      .update(users)
      // An admin's approval PIN goes with the admin role.
      .set({ ...rest, ...(passwordHash && { passwordHash }), ...(rest.role !== "admin" && { approvalPinHash: null }) })
      .where(eq(users.id, id))
      .returning(publicColumns);
    if (password || !rest.active) await deleteUserSessions(tx, id);
    const diff = changedFields({ ...before, passwordChanged: false }, { ...rest, passwordChanged: Boolean(password) });
    if (diff) {
      await audit(tx, actor, {
        action: "user.update",
        entityId: id,
        summary: `Pengguna ${user!.username} diubah${diff.after.role ? `: peran ${roleLabels[diff.after.role]}` : ""}`,
        ...diff,
      });
    }
    return user!;
  });
}
