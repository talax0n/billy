import { beforeAll, expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

const { call, signIn } = await createTestApp();
let cookie: string;
let kasirCookie: string;

beforeAll(async () => {
  ({ cookie } = await signIn("staff"));
  ({ cookie: kasirCookie } = await signIn("kasir"));
});

async function create(body: object) {
  const res = await call("/api/contacts", { method: "POST", cookie, body });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const json = async (path: string) => (await call(path, { cookie })).json();

it("suggests the next code per kind and creates a contact with defaults", async () => {
  expect(await json("/api/contacts/next-code?kind=customer")).toEqual({ code: "CUST-0001" });
  const { status, body } = await create({ code: "CUST-0001", name: "Toko Bangun Jaya", kind: "customer", phone: "0812 555" });
  expect(status).toBe(201);
  expect(body).toMatchObject({ code: "CUST-0001", kind: "customer", email: "", paymentTermsDays: 0, active: true });
  expect(await json("/api/contacts/next-code?kind=customer")).toEqual({ code: "CUST-0002" });
  expect(await json("/api/contacts/next-code?kind=supplier")).toEqual({ code: "SUPP-0001" });
});

it("filters the list by kind and search, and paginates", async () => {
  await create({ code: "SUPP-0001", name: "PT Warna Prima", kind: "supplier", paymentTermsDays: 30 });
  await create({ code: "SUPP-0002", name: "CV Kuas Abadi", kind: "supplier" });
  await create({ code: "EMP-0001", name: "Budi", kind: "employee" });

  expect(await json("/api/contacts?kind=supplier")).toMatchObject({
    total: 2,
    rows: [{ code: "SUPP-0002" }, { code: "SUPP-0001" }],
  });
  expect(await json("/api/contacts?q=warna%20prima")).toMatchObject({ total: 1, rows: [{ name: "PT Warna Prima" }] });
  expect(await json("/api/contacts?q=0812")).toMatchObject({ total: 1, rows: [{ code: "CUST-0001" }] });
  const page2 = (await json("/api/contacts?pageSize=3&page=2")) as { total: number; rows: unknown[] };
  expect(page2.total).toBe(4);
  expect(page2.rows).toHaveLength(1);
});

it("looks up active contacts of a kind with their payment terms", async () => {
  expect(await json("/api/contacts/lookup?kind=supplier&q=prima")).toEqual([
    { id: expect.any(String), code: "SUPP-0001", name: "PT Warna Prima", paymentTermsDays: 30 },
  ]);
});

it("deactivates a contact, which hides it from the lookup but keeps it in the list", async () => {
  const { body } = await create({ code: "OTH-0001", name: "Pak RT", kind: "other" });
  const res = await call(`/api/contacts/${body.id}`, {
    method: "PUT",
    cookie,
    body: { code: "OTH-0001", name: "Pak RT", kind: "other", active: false, paymentTermsDays: 7 },
  });
  expect(await res.json()).toMatchObject({ active: false, paymentTermsDays: 7 });
  expect(await json("/api/contacts/lookup?kind=other")).toEqual([]);
  expect(await json("/api/contacts?kind=other")).toMatchObject({ total: 1, rows: [{ active: false }] });
});

it("rejects a duplicate code and an invalid email per field", async () => {
  const dup = await create({ code: "CUST-0001", name: "Lain", kind: "customer" });
  expect(dup).toEqual({ status: 409, body: { error: "Nilai sudah dipakai data lain", fields: { code: "Sudah dipakai" } } });
  const bad = await create({ code: "CUST-0009", name: "X", kind: "customer", email: "x@" });
  expect(bad).toEqual({ status: 400, body: { error: "Periksa kembali isian", fields: { email: "Email tidak valid" } } });
});

it("is back office only", async () => {
  for (const path of ["/api/contacts", "/api/contacts/lookup", "/api/contacts/next-code?kind=customer"]) {
    expect((await call(path, { cookie: kasirCookie })).status).toBe(403);
  }
  expect((await call("/api/contacts", { method: "POST", cookie: kasirCookie, body: {} })).status).toBe(403);
});
