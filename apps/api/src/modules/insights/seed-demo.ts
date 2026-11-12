import { fileURLToPath } from "node:url";
import { createDb, isEmpty, seed, users } from "@billy/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "../../auth/password.ts";
import { seedInsightDemo } from "./fixture.ts";

if (process.env.NODE_ENV === "production" || process.env.DATABASE_URL)
  throw new Error("seed:demo hanya untuk PGlite lokal");
const database = await createDb({
  dataDir: fileURLToPath(
    new URL("../../../../../.data/pglite", import.meta.url),
  ),
});
try {
  await database.migrate();
  if (await isEmpty(database.db))
    await seed(database.db, {
      adminPasswordHash: await hashPassword(
        process.env.SEED_ADMIN_PASSWORD ?? "admin12345",
      ),
    });
  const [admin] = await database.db
    .select()
    .from(users)
    .where(eq(users.role, "admin"));
  if (!admin) throw new Error("Admin tidak ditemukan");
  console.log(await seedInsightDemo(database.db, admin.id));
} finally {
  await database.close();
}
