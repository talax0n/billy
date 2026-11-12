import { expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

it("creates, searches, updates and deactivates contacts with role restrictions", async () => {
  const { call, signIn } = await createTestApp();
  const { cookie } = await signIn("staff");
  const cashier = await signIn("kasir");
  const input = { code: "CUST-001", name: "Sumber", kind: "customer" };
  const created = await call("/api/contacts", { method: "POST", cookie, body: input });
  expect(created.status).toBe(201);
  const row = await created.json() as { id: string };
  expect(await (await call("/api/contacts/lookup?kind=customer&q=sumber", { cookie })).json()).toMatchObject([{ id: row.id, code: "CUST-001", name: "Sumber", paymentTermsDays: 0 }]);
  expect(await (await call("/api/contacts?kind=supplier", { cookie })).json()).toMatchObject({ total: 0 });
  const updated = await call(`/api/contacts/${row.id}`, { method: "PUT", cookie, body: { ...input, active: false, paymentTermsDays: 30 } });
  expect(await updated.json()).toMatchObject({ active: false, paymentTermsDays: 30 });
  expect(await (await call("/api/contacts/lookup", { cookie })).json()).toEqual([]);
  expect((await call("/api/contacts", { cookie: cashier.cookie })).status).toBe(403);
  expect((await call("/api/contacts/lookup", { cookie: cashier.cookie })).status).toBe(403);
});
