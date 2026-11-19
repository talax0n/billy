import { auditEvents, categories, products } from "@billy/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

const { call, signIn, db } = await createTestApp();
let staff: string;
let kasir: string;

beforeAll(async () => {
  ({ cookie: staff } = await signIn("staff"));
  ({ cookie: kasir } = await signIn("kasir"));
});

const autoAssign = (cookie: string) => call("/api/categories/auto-assign", { method: "POST", cookie });
const categoryOf = async (name: string) =>
  (
    await db
      .select({ category: categories.name })
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .where(eq(products.name, name))
  )[0]!.category;

describe("filling brands automatically", () => {
  it("gives uncategorised products their brand and leaves the rest alone", async () => {
    const [own, discounted] = await db.insert(categories).values([{ name: "DULUX" }, { name: "Diskon" }]).returning({ id: categories.id });
    await db.insert(products).values([
      { name: "CATYLAC EXTERIOR BASE A GALON", unit: "GALON" },
      { name: "WEATHERSHIELD BASE B PAIL", unit: "PAIL" },
      { name: "WEATHERBOND SOLAREFLECT BASE A PAIL", unit: "PAIL" },
      { name: "Kuas 3 inch", unit: "PCS" },
      { name: "TOP COLOR 1156 LIGHT IVORY LITER", unit: "LITER" },
      { name: "VINILEX 5000 PUTIH PAIL", unit: "PAIL", categoryId: discounted!.id },
    ]);

    const res = await autoAssign(staff);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      assigned: 4,
      brands: [
        { id: own!.id, name: "DULUX", count: 2 },
        { name: "Kuas", count: 1 },
        { name: "Nippon Paint", count: 1 },
      ],
    });

    expect(await categoryOf("CATYLAC EXTERIOR BASE A GALON")).toBe("DULUX");
    expect(await categoryOf("WEATHERBOND SOLAREFLECT BASE A PAIL")).toBe("Nippon Paint");
    expect(await categoryOf("Kuas 3 inch")).toBe("Kuas");
    expect(await categoryOf("TOP COLOR 1156 LIGHT IVORY LITER")).toBeNull();
    expect(await categoryOf("VINILEX 5000 PUTIH PAIL")).toBe("Diskon");

    const logged = await db.select({ summary: auditEvents.summary }).from(auditEvents).where(eq(auditEvents.action, "category.auto_assign"));
    expect(logged.map((e) => e.summary).sort()).toEqual([
      "Kategori DULUX: 2 produk diisi otomatis",
      "Kategori Kuas: 1 produk diisi otomatis",
      "Kategori Nippon Paint: 1 produk diisi otomatis",
    ]);
  });

  it("changes nothing when run again", async () => {
    expect(await (await autoAssign(staff)).json()).toEqual({ assigned: 0, brands: [] });
  });

  it("is not open to the kasir", async () => {
    expect((await autoAssign(kasir)).status).toBe(403);
  });
});
