import { businessDate } from "@billy/core";
import { cashEntries } from "@billy/db";
import { asc, eq } from "drizzle-orm";
import { beforeAll, expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

const { call, db, signIn } = await createTestApp();
let cookie: string;
let kasirCookie: string;
let kas: string;

const post = async (path: string, body: object, as = cookie) => {
  const res = await call(path, { method: "POST", cookie: as, body });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const json = async (path: string) => (await call(path, { cookie })).json();
const entriesOf = (sourceId: string) =>
  db
    .select({ accountId: cashEntries.accountId, date: cashEntries.date, direction: cashEntries.direction, amount: cashEntries.amount, category: cashEntries.category, note: cashEntries.note })
    .from(cashEntries)
    .where(eq(cashEntries.sourceId, sourceId))
    .orderBy(asc(cashEntries.createdAt));

beforeAll(async () => {
  ({ cookie } = await signIn("staff"));
  ({ cookie: kasirCookie } = await signIn("kasir"));
  kas = (await post("/api/accounts", { code: "KAS", name: "Kas Toko", kind: "cash" })).body.id as string;
});

const expense = { date: "2026-11-13", category: "Listrik", description: "PLN November", amount: 450_000 };

it("numbers the expense per day and writes a cash entry out / expense", async () => {
  const first = await post("/api/expenses", { ...expense, accountId: kas });
  expect(first.status).toBe(201);
  expect(first.body).toMatchObject({ number: "BY-261113-0001", accountName: "Kas Toko", amount: 450_000, proofUrl: null, voidedAt: null });
  expect(await entriesOf(first.body.id as string)).toEqual([
    { accountId: kas, date: "2026-11-13", direction: "out", amount: 450_000, category: "expense", note: "Listrik: PLN November" },
  ]);

  const second = await post("/api/expenses", { ...expense, accountId: kas, category: "Bensin motor antar", description: "", amount: 50_000, proofUrl: "https://example.com/nota.jpg" });
  expect(second.body).toMatchObject({ number: "BY-261113-0002", category: "Bensin motor antar", proofUrl: "https://example.com/nota.jpg" });
  expect((await post("/api/expenses", { ...expense, accountId: kas, date: "2026-10-31", category: "Sewa", description: "Ruko Oktober", amount: 2_000_000 })).body).toMatchObject({
    number: "BY-261031-0001",
  });
  expect(await json(`/api/accounts/${kas}`)).toMatchObject({ balance: -2_500_000 });
});

it("lists a month with the total of its non-voided expenses", async () => {
  expect(await json("/api/expenses?month=2026-11")).toMatchObject({
    total: 2,
    amountTotal: 500_000,
    rows: [{ number: "BY-261113-0002" }, { number: "BY-261113-0001" }],
  });
  expect(await json("/api/expenses?month=2026-10")).toMatchObject({ total: 1, amountTotal: 2_000_000 });
  expect(await json("/api/expenses?q=pln")).toMatchObject({ total: 1, rows: [{ number: "BY-261113-0001" }] });
  expect(await json("/api/expenses?month=2026-11&pageSize=1&page=2")).toMatchObject({
    total: 2,
    amountTotal: 500_000,
    rows: [{ number: "BY-261113-0001" }],
  });
});

it("voids with a reason: a reversal entry, out of the period total, and only once", async () => {
  const list = (await json("/api/expenses?q=pln")) as { rows: { id: string }[] };
  const id = list.rows[0]!.id;

  const voided = await post(`/api/expenses/${id}/void`, { reason: "Dobel input" });
  expect(voided.status).toBe(200);
  expect(voided.body).toMatchObject({ voidReason: "Dobel input", voidedAt: expect.any(String) });
  expect(await entriesOf(id)).toEqual([
    { accountId: kas, date: "2026-11-13", direction: "out", amount: 450_000, category: "expense", note: "Listrik: PLN November" },
    { accountId: kas, date: businessDate(), direction: "in", amount: 450_000, category: "reversal", note: "Pembatalan: Dobel input" },
  ]);
  expect(await json("/api/expenses?month=2026-11")).toMatchObject({ total: 2, amountTotal: 50_000 });
  expect(await json(`/api/accounts/${kas}`)).toMatchObject({ balance: -2_050_000 });

  expect(await post(`/api/expenses/${id}/void`, { reason: "Lagi" })).toEqual({ status: 409, body: { error: "Biaya ini sudah dibatalkan" } });
});

it("rejects missing fields and an unknown account", async () => {
  expect(await post("/api/expenses", { date: "2026-11-13", accountId: "", category: " ", amount: 0, proofUrl: "nota" })).toEqual({
    status: 400,
    body: {
      error: "Periksa kembali isian",
      fields: {
        accountId: "Pilih akun pembayar",
        category: "Kategori wajib diisi",
        amount: "Jumlah harus lebih dari 0",
        proofUrl: "Tautan bukti tidak valid",
      },
    },
  });
  expect(await post("/api/expenses", { ...expense, accountId: "01a1d234-3800-7000-8000-000000000000" })).toEqual({
    status: 422,
    body: { error: "Akun tidak ditemukan atau sudah nonaktif" },
  });
});

it("is back office only", async () => {
  expect((await call("/api/expenses", { cookie: kasirCookie })).status).toBe(403);
  expect((await post("/api/expenses", { ...expense, accountId: kas }, kasirCookie)).status).toBe(403);
});
