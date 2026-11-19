import { fileURLToPath } from "node:url";
import { createDb, isEmpty, seed } from "@billy/db";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { hashPassword } from "./auth/password.ts";
import { pollTelegram } from "./modules/telegram/telegram-api.ts";

const DEV_ADMIN_PASSWORD = "admin12345";

// Encrypts the keys saved in Pengaturan, Koneksi. Production sets its own; this one is for local data only.
process.env.BILLY_SECRET_KEY ??= "billy-local-development-only";

const database = await createDb({
  url: process.env.DATABASE_URL,
  dataDir: process.env.PGLITE_DIR ?? fileURLToPath(new URL("../../../.data/pglite", import.meta.url)),
});
await database.migrate();

if (await isEmpty(database.db)) {
  const password = process.env.SEED_ADMIN_PASSWORD ?? DEV_ADMIN_PASSWORD;
  await seed(database.db, { adminPasswordHash: await hashPassword(password) });
  console.log(
    process.env.SEED_ADMIN_PASSWORD
      ? "seeded: sign in as admin with SEED_ADMIN_PASSWORD"
      : `seeded: sign in as admin / ${DEV_ADMIN_PASSWORD} (dev only)`,
  );
}

const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: createApp(database.db).fetch, port }, () =>
  console.log(`api on http://localhost:${port}/api`),
);

// No public URL here for Telegram's webhook, so long-poll instead. It idles until a bot token is set,
// in the web or as TELEGRAM_BOT_TOKEN.
void pollTelegram(database.db);

// PGlite writes to disk: close it cleanly so a restart never finds a half-written data dir.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.close(() => void database.close().then(() => process.exit(0))));
}
