import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import pg from "pg";
import * as schema from "./schema.ts";

/** Driver-agnostic database handle. A transaction (`tx`) is assignable to it too. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: Db;
  /** Applies pending drizzle-kit migrations from `src/migrations`. */
  migrate(): Promise<void>;
  close(): Promise<void>;
}

const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url));

/**
 * `url` set: node-postgres pool (Neon pooled URL in production).
 * Otherwise PGlite, persisted under `dataDir` when given, in memory when not (tests).
 */
export async function createDb(options: { url?: string | undefined; dataDir?: string | undefined } = {}): Promise<Database> {
  if (options.url) {
    const pool = new pg.Pool({ connectionString: options.url });
    const db = drizzlePg({ client: pool, schema, casing: "snake_case" });
    return { db, migrate: () => migratePg(db, { migrationsFolder }), close: () => pool.end() };
  }
  if (options.dataDir) mkdirSync(options.dataDir, { recursive: true });
  const client = await PGlite.create(options.dataDir);
  const db = drizzlePglite({ client, schema, casing: "snake_case" });
  return { db, migrate: () => migratePglite(db, { migrationsFolder }), close: () => client.close() };
}
