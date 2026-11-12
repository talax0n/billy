import { createDb } from "@billy/db";
import { expect, it } from "vitest";
import { allocateDocNumber } from "./doc-number.ts";

it("counts per prefix and business date", async () => {
  const { db, migrate } = await createDb();
  await migrate();
  expect(await allocateDocNumber(db, "SO", "2026-11-13")).toBe("SO-261113-0001");
  expect(await allocateDocNumber(db, "SO", "2026-11-13")).toBe("SO-261113-0002");
  expect(await allocateDocNumber(db, "PO", "2026-11-13")).toBe("PO-261113-0001");
  expect(await allocateDocNumber(db, "SO", "2026-11-14")).toBe("SO-261114-0001");
});
