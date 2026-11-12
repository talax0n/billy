import { expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

it("records and reverses cash movements and protects back office", async () => {
  const { call, signIn } = await createTestApp();
  const { cookie } = await signIn("staff");
  const cashier = await signIn("kasir");
  const post = (path: string, body: object) => call(path, { method: "POST", cookie, body });
  const a = await (await post("/api/accounts", { code: "KAS", name: "Kas", kind: "cash" })).json() as { id: string };
  const b = await (await post("/api/accounts", { code: "BANK", name: "Bank", kind: "bank" })).json() as { id: string };
  expect((await call("/api/accounts/lookup", { cookie: cashier.cookie })).status).toBe(200);
  expect((await call("/api/accounts", { cookie: cashier.cookie })).status).toBe(403);
  expect((await call("/api/expenses", { cookie: cashier.cookie })).status).toBe(403);
  expect((await post("/api/cash/entries", { accountId: a.id, date: "2026-11-13", direction: "in", amount: 100000, note: "Modal" })).status).toBe(201);
  expect((await post("/api/cash/transfers", { fromAccountId: a.id, toAccountId: a.id, date: "2026-11-13", amount: 10000 })).status).toBe(422);
  const transfer = await (await post("/api/cash/transfers", { fromAccountId: a.id, toAccountId: b.id, date: "2026-11-13", amount: 30000 })).json() as { id: string };
  const expense = await (await post("/api/expenses", { accountId: b.id, date: "2026-11-13", amount: 12000, category: "Listrik" })).json() as { id: string; number: string };
  expect(expense.number).toBe("BY-261113-0001");
  expect(await (await call("/api/accounts", { cookie })).json()).toMatchObject({ total: 88000, rows: [{ code: "BANK", balance: 18000 }, { code: "KAS", balance: 70000 }] });
  expect(await (await call(`/api/accounts/${a.id}/entries`, { cookie })).json()).toMatchObject({ rows: [{ direction: "in", balance: 100000 }, { direction: "out", balance: 70000 }] });
  expect((await post(`/api/expenses/${expense.id}/void`, { reason: "Salah" })).status).toBe(200);
  expect((await post(`/api/cash/transfers/${transfer.id}/void`, { reason: "Salah" })).status).toBe(200);
  expect((await post(`/api/expenses/${expense.id}/void`, { reason: "Lagi" })).status).toBe(409);
  expect(await (await call("/api/accounts", { cookie })).json()).toMatchObject({ total: 100000, rows: [{ code: "BANK", balance: 0 }, { code: "KAS", balance: 100000 }] });
  expect(await (await call(`/api/accounts/${b.id}/entries`, { cookie })).json()).toMatchObject({ total: 4, rows: [{ category: "transfer", direction: "in", amount: 30000 }, { category: "expense", direction: "out", amount: 12000 }, { category: "reversal", direction: "in", amount: 12000 }, { category: "reversal", direction: "out", amount: 30000 }] });
});
