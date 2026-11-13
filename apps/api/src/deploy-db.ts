/**
 * Deploy step: applies migrations and creates the first admin on an empty database.
 * Uses the direct (unpooled) Neon URL; without one (preview deploys) it does nothing.
 */
import { createDb, isEmpty, seed } from "@billy/db";
import { hashPassword } from "./auth/password.ts";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.log("deploy-db: no DATABASE_URL, skipping migrations");
  process.exit(0);
}

const database = await createDb({ url });
await database.migrate();
console.log("deploy-db: migrations applied");
if (await isEmpty(database.db)) {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) throw new Error("deploy-db: empty database and no SEED_ADMIN_PASSWORD for the first admin");
  await seed(database.db, { adminPasswordHash: await hashPassword(password) });
  console.log("deploy-db: seeded, sign in as admin with SEED_ADMIN_PASSWORD");
}
await database.close();
