import { DomainError, type PaginationQuery, type userCreateInput, type userUpdateInput } from "@billy/core";
import { type Db, users } from "@billy/db";
import { asc, count, eq, ilike, or } from "drizzle-orm";
import type { z } from "zod";
import { hashPassword } from "../../auth/password.ts";
import { deleteUserSessions } from "../../auth/session.ts";
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

export async function createUser(db: Db, input: z.output<typeof userCreateInput>) {
  const { password, ...rest } = input;
  const [user] = await db
    .insert(users)
    .values({ ...rest, passwordHash: await hashPassword(password) })
    .returning(publicColumns);
  return user!;
}

export async function updateUser(db: Db, actorId: string, id: string, input: z.output<typeof userUpdateInput>) {
  const { password, ...rest } = input;
  if (id === actorId && (!rest.active || rest.role !== "admin")) {
    throw new DomainError("conflict", "Anda tidak bisa menonaktifkan atau menurunkan peran akun sendiri");
  }
  return db.transaction(async (tx) => {
    const [user] = await tx
      .update(users)
      .set({ ...rest, ...(password && { passwordHash: await hashPassword(password) }) })
      .where(eq(users.id, id))
      .returning(publicColumns);
    if (!user) throw new DomainError("not_found", "Pengguna tidak ditemukan");
    if (password || !rest.active) await deleteUserSessions(tx, id);
    return user;
  });
}
