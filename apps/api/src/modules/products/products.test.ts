import { beforeAll, expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

const { call, signIn } = await createTestApp();
let cookie: string;

beforeAll(async () => {
  ({ cookie } = await signIn("staff"));
});

const product = {
  code: "CT-100",
  barcode: "",
  name: "Warnaku Tembok",
  variant: "Putih 5 kg",
  unit: "pail",
  categoryId: null,
  sellPrice: 185_000,
  costPrice: 152_000,
  minStock: 5,
};

async function create(body: object) {
  const res = await call("/api/products", { method: "POST", cookie, body });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

it("creates a product with zero derived stock", async () => {
  const { status, body } = await create(product);
  expect(status).toBe(201);
  expect(body).toMatchObject({ code: "CT-100", barcode: null, stock: 0, active: true, categoryName: null });
});

it("derives stock from adjustments and lists the movement history", async () => {
  const { body: created } = await create({ ...product, code: "CT-101", name: "Kilau Enamel" });
  const id = created.id as string;

  for (const [qty, note] of [
    [10, "Stok awal"],
    [-3, "Kaleng penyok"],
  ] as const) {
    const res = await call(`/api/products/${id}/adjustments`, { method: "POST", cookie, body: { qty, note } });
    expect(res.status).toBe(201);
  }

  const detail = await call(`/api/products/${id}`, { cookie });
  expect(await detail.json()).toMatchObject({ stock: 7 });

  const list = await call("/api/products?q=enamel%20ct-101", { cookie });
  expect(await list.json()).toMatchObject({ total: 1, rows: [{ id, stock: 7 }] });

  const history = await call(`/api/products/${id}/movements`, { cookie });
  expect(await history.json()).toMatchObject({
    total: 2,
    rows: [
      { qty: -3, reason: "adjustment", note: "Kaleng penyok", unitCost: 152_000, createdByName: "Uji staff" },
      { qty: 10, reason: "adjustment", note: "Stok awal" },
    ],
  });
});

it("paginates the list", async () => {
  const res = await call("/api/products?pageSize=1&page=2", { cookie });
  const body = (await res.json()) as { rows: unknown[]; total: number };
  expect(body.total).toBe(2);
  expect(body.rows).toHaveLength(1);
});

it("updates master fields and deactivates", async () => {
  const { body: created } = await create({ ...product, code: "CT-102" });
  const res = await call(`/api/products/${created.id}`, {
    method: "PUT",
    cookie,
    body: { ...product, code: "CT-102", sellPrice: 190_000, active: false },
  });
  expect(await res.json()).toMatchObject({ sellPrice: 190_000, active: false });
});

it("explains invalid input per field", async () => {
  const { body: created } = await create({ ...product, code: "CT-103" });
  const res = await call(`/api/products/${created.id}/adjustments`, { method: "POST", cookie, body: { qty: 0, note: " " } });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({
    error: "Periksa kembali isian",
    fields: { qty: "Jumlah tidak boleh 0", note: "Alasan penyesuaian wajib diisi" },
  });
});

it("rejects a duplicate code with 409 on the code field", async () => {
  const { status, body } = await create(product);
  expect(status).toBe(409);
  expect(body).toEqual({ error: "Nilai sudah dipakai data lain", fields: { code: "Sudah dipakai" } });
});

it("returns 404 for an unknown product", async () => {
  const res = await call("/api/products/01a1d234-3800-7000-8000-000000000000", { cookie });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "Produk tidak ditemukan" });
});
