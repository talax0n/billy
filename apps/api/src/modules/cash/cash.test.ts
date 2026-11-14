import { cashEntries } from "@billy/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestApp } from "../../testing.ts";

// Voids are dated on the business date they happen: 13 Nov here.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-11-13T07:00:00Z"));
afterAll(() => vi.useRealTimers());

const { call, db, signIn } = await createTestApp();
let cookie: string;
let kasirCookie: string;
let kas: string;
let bca: string;

const post = async (path: string, body: object, as = cookie) => {
  const res = await call(path, { method: "POST", cookie: as, body });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const json = async (path: string) => (await call(path, { cookie })).json();
const entriesOf = (sourceId: string) =>
  db
    .select({ accountId: cashEntries.accountId, date: cashEntries.date, direction: cashEntries.direction, amount: cashEntries.amount, category: cashEntries.category })
    .from(cashEntries)
    .where(eq(cashEntries.sourceId, sourceId))
    .orderBy(asc(cashEntries.createdAt), asc(cashEntries.direction));

beforeAll(async () => {
  ({ cookie } = await signIn("staff"));
  ({ cookie: kasirCookie } = await signIn("kasir"));
  kas = (await post("/api/accounts", { code: "KAS", name: "Kas Toko", kind: "cash" })).body.id as string;
  bca = (await post("/api/accounts", { code: "BCA", name: "BCA Operasional", kind: "bank" })).body.id as string;
});

it("records manual money in and out with the other_in / other_out category", async () => {
  const masuk = await post("/api/cash/entries", { accountId: kas, date: "2026-11-01", direction: "in", amount: 5_000_000, note: "Modal awal" });
  expect(masuk.status).toBe(201);
  expect(masuk.body).toMatchObject({ direction: "in", amount: 5_000_000, category: "other_in", sourceType: "manual", sourceId: null });
  const keluar = await post("/api/cash/entries", { accountId: kas, date: "2026-11-02", direction: "out", amount: 200_000, note: "Sumbangan 17-an" });
  expect(keluar.body).toMatchObject({ category: "other_out" });
  expect(await json(`/api/accounts/${kas}`)).toMatchObject({ code: "KAS", balance: 4_800_000 });
});

it("requires a note on manual cash and a positive amount", async () => {
  const res = await post("/api/cash/entries", { accountId: kas, date: "2026-11-02", direction: "out", amount: 0, note: " " });
  expect(res).toEqual({
    status: 400,
    body: { error: "Periksa kembali isian", fields: { amount: "Jumlah harus lebih dari 0", note: "Keterangan wajib diisi" } },
  });
});

it("transfers between accounts with an out and an in entry, and voids with reversals", async () => {
  const transfer = await post("/api/cash/transfers", { fromAccountId: kas, toAccountId: bca, date: "2026-11-03", amount: 1_500_000, note: "Setor bank" });
  expect(transfer.status).toBe(201);
  const id = transfer.body.id as string;
  expect(await entriesOf(id)).toEqual([
    { accountId: bca, date: "2026-11-03", direction: "in", amount: 1_500_000, category: "transfer" },
    { accountId: kas, date: "2026-11-03", direction: "out", amount: 1_500_000, category: "transfer" },
  ]);
  expect(await json("/api/accounts")).toMatchObject({
    total: 2,
    balanceTotal: 4_800_000,
    rows: [
      { code: "KAS", balance: 3_300_000 },
      { code: "BCA", balance: 1_500_000 },
    ],
  });

  const voided = await post(`/api/cash/transfers/${id}/void`, { reason: "Salah akun" });
  expect(voided.status).toBe(200);
  expect(voided.body).toMatchObject({ voidReason: "Salah akun", voidedAt: expect.any(String) });
  expect((await entriesOf(id)).filter((e) => e.category === "reversal")).toEqual([
    { accountId: kas, date: "2026-11-13", direction: "in", amount: 1_500_000, category: "reversal" },
    { accountId: bca, date: "2026-11-13", direction: "out", amount: 1_500_000, category: "reversal" },
  ]);
  expect(await json(`/api/accounts/${kas}`)).toMatchObject({ balance: 4_800_000 });
  expect(await json(`/api/accounts/${bca}`)).toMatchObject({ balance: 0 });

  expect(await post(`/api/cash/transfers/${id}/void`, { reason: "Lagi" })).toEqual({
    status: 409,
    body: { error: "Transfer ini sudah dibatalkan" },
  });
});

it("rejects a transfer to the same account and a void without reason", async () => {
  expect(await post("/api/cash/transfers", { fromAccountId: kas, toAccountId: kas, date: "2026-11-03", amount: 10_000 })).toEqual({
    status: 400,
    body: { error: "Periksa kembali isian", fields: { toAccountId: "Akun tujuan harus berbeda dari akun asal" } },
  });
  expect((await post("/api/cash/transfers/01a1d234-3800-7000-8000-000000000000/void", { reason: "" })).body).toEqual({
    error: "Periksa kembali isian",
    fields: { reason: "Alasan pembatalan wajib diisi" },
  });
  expect((await post("/api/cash/transfers/01a1d234-3800-7000-8000-000000000000/void", { reason: "x" })).status).toBe(404);
});

it("shows the cash book newest first with a running balance, filters and period totals", async () => {
  await post("/api/cash/entries", { accountId: kas, date: "2026-11-05", direction: "in", amount: 300_000, note: "Titipan" });

  expect(await json(`/api/accounts/${kas}/entries`)).toMatchObject({
    total: 5,
    totalIn: 6_800_000,
    totalOut: 1_700_000,
    rows: [
      { date: "2026-11-13", direction: "in", category: "reversal", note: "Pembatalan: Salah akun", balance: 5_100_000, voidable: false },
      { date: "2026-11-05", direction: "in", amount: 300_000, category: "other_in", balance: 3_600_000, createdByName: "Uji staff" },
      { date: "2026-11-03", direction: "out", category: "transfer", balance: 3_300_000, voidable: false },
      { date: "2026-11-02", direction: "out", amount: 200_000, balance: 4_800_000 },
      { date: "2026-11-01", direction: "in", amount: 5_000_000, balance: 5_000_000 },
    ],
  });

  const filtered = await json(`/api/accounts/${kas}/entries?from=2026-11-02&to=2026-11-03&direction=out`);
  expect(filtered).toMatchObject({
    total: 2,
    totalIn: 0,
    totalOut: 1_700_000,
    rows: [
      { category: "transfer", balance: 3_300_000 },
      { category: "other_out", balance: 4_800_000 },
    ],
  });
  expect(await json(`/api/accounts/${kas}/entries?category=other_in&pageSize=1&page=2`)).toMatchObject({
    total: 2,
    rows: [{ amount: 5_000_000, balance: 5_000_000 }],
  });
});

it("refuses cash on an inactive account but keeps it out of the lookup only", async () => {
  const lama = (await post("/api/accounts", { code: "LAMA", name: "Rekening lama", kind: "bank" })).body.id as string;
  const res = await call(`/api/accounts/${lama}`, { method: "PUT", cookie, body: { code: "LAMA", name: "Rekening lama", kind: "bank", active: false } });
  expect(await res.json()).toMatchObject({ active: false, balance: 0 });
  expect(await post("/api/cash/entries", { accountId: lama, date: "2026-11-05", direction: "in", amount: 1, note: "x" })).toEqual({
    status: 422,
    body: { error: "Akun tidak ditemukan atau sudah nonaktif" },
  });
  expect(await json("/api/accounts/lookup")).toEqual([
    { id: kas, code: "KAS", name: "Kas Toko", kind: "cash" },
    { id: bca, code: "BCA", name: "BCA Operasional", kind: "bank" },
  ]);
});

it("lets a kasir read the account lookup and nothing else", async () => {
  expect((await call("/api/accounts/lookup", { cookie: kasirCookie })).status).toBe(200);
  expect((await call("/api/accounts", { cookie: kasirCookie })).status).toBe(403);
  expect((await call(`/api/accounts/${kas}/entries`, { cookie: kasirCookie })).status).toBe(403);
  expect((await post("/api/cash/entries", {}, kasirCookie)).status).toBe(403);
  expect((await post("/api/cash/transfers", {}, kasirCookie)).status).toBe(403);
  expect((await call("/api/accounts/lookup")).status).toBe(401);
});
