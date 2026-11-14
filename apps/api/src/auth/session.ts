import { createHash, randomBytes } from "node:crypto";
import { type Db, sessions, users } from "@billy/db";
import { and, eq, gt } from "drizzle-orm";
import type { SessionUser } from "../env.ts";

export const SESSION_COOKIE = "billy_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Only the hash is stored, so a leaked sessions table cannot be replayed as cookies. */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
  });
  return token;
}

/** The active user behind a live session token, or null. */
export async function findSessionUser(db: Db, token: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({ id: users.id, username: users.username, name: users.name, role: users.role, sessionStartedAt: sessions.createdAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date()), eq(users.active, true)));
  return row ? { ...row, sessionStartedAt: row.sessionStartedAt.toISOString() } : null;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function deleteUserSessions(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
