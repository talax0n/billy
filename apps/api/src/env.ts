import type { Role } from "@billy/core";
import type { Db } from "@billy/db";

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  role: Role;
}

/** Every request carries the database; set once in `createApp`, so tests inject an in-memory one. */
export interface AppEnv {
  Variables: { db: Db };
}

/** After `requireRole`, handlers also see the signed-in user. */
export interface AuthedEnv {
  Variables: { db: Db; user: SessionUser };
}
