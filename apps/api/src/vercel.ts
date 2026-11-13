/**
 * Vercel entry: the same app as `dev.ts`, on Neon Postgres. Bundled by `build:vercel` into
 * `.vercel/output`; migrations and the first admin run at deploy time (`deploy-db.ts`), not here.
 * A missing database never crashes the function: every request then answers 503 with the reason.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createDb } from "@billy/db";
import { getRequestListener } from "@hono/node-server";
import { createApp } from "./app.ts";

// Neon's Vercel integration names the pooled URL DATABASE_URL (or POSTGRES_URL in older setups).
const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

const listener = url
  ? createDb({ url }).then(({ db }) => getRequestListener(createApp(db).fetch))
  : Promise.reject(new Error("DATABASE_URL is not set: connect the Neon database to this Vercel project and redeploy"));
listener.catch((e: unknown) => console.error(e));

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await (await listener)(req, res);
  } catch (e) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : "API failed to start" }));
  }
}
