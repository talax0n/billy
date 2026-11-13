/**
 * Vercel entry: the same app as `dev.ts`, on Neon Postgres. Bundled by `build:vercel` into
 * `.vercel/output`; migrations and the first admin run at deploy time (`deploy-db.ts`), not here.
 */
import { createDb } from "@billy/db";
import { getRequestListener } from "@hono/node-server";
import { createApp } from "./app.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set: connect the Neon database to this Vercel project");

const { db } = await createDb({ url });
export default getRequestListener(createApp(db).fetch);
