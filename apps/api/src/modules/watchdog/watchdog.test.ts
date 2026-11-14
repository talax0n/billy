import { addDays, businessDate, rupiah, uuidv7, type WatchdogFlag, type WatchdogFlagType } from "@billy/core";
import { accounts, auditEvents, posDrafts, products, settings, stockMovements } from "@billy/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

const { call, signIn, db } = await createTestApp();
const PIN = "246810";
const today = businessDate();
const daysAgo = (n: number) => addDays(today, -n);
/** An instant on a business day, Jakarta wall-clock time. */
const at = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`);

let admin: string;
let adminId: string;
let staff: string;
let kas: string;
let cat: string;
let n = 0;

beforeAll(async () => {
  ({ cookie: admin, user: { id: adminId } } = await signIn("admin"));
  ({ cookie: staff } = await signIn("staff"));
  await db.insert(settings).values({ shopName: "Toko Uji", receiptFooter: "", posDeviceCode: "K1" });
  [{ id: kas }] = (await db.insert(accounts).values({ code: "KAS", name: "Kas Toko", kind: "cash" }).returning({ id: accounts.id })) as [{ id: string }];
  [{ id: cat }] = (await db
    .insert(products)
    .values({ name: "Cat", variant: "1 L", unit: "kaleng", sellPrice: rupiah(10_000), costPrice: rupiah(6_000) })
    .returning({ id: products.id })) as [{ id: string }];
  await db.insert(stockMovements).values({ productId: cat, date: today, qty: 1_000, reason: "adjustment", unitCost: rupiah(6_000), createdBy: adminId });
  expect((await call("/api/approvals/pin", { method: "PUT", cookie: admin, body: { password: "rahasia123", pin: PIN } })).status).toBe(200);
});

const post = (path: string, cookie: string, body: unknown = {}) => call(path, { method: "POST", cookie, body });

async function flags(type: WatchdogFlagType, from: string, to = from): Promise<WatchdogFlag[]> {
  const res = await call(`/api/watchdog?from=${from}&to=${to}`, { cookie: admin });
  expect(res.status).toBe(200);
  return ((await res.json()) as { rows: WatchdogFlag[] }).rows.filter((f) => f.type === type);
}
const whose = (list: WatchdogFlag[], userId: string) => list.filter((f) => f.who?.id === userId);


/** One line of `qty` × `unitPrice`, paid in cash. */
const sale = ({ unitPrice = 10_000, qty = 1, discountBp = 0, soldAt = new Date(), approval }: Record<string, unknown> = {}) => {
  const gross = (qty as number) * (unitPrice as number);
  const total = gross - Math.round((gross * (discountBp as number)) / 10_000);
  return {
    id: uuidv7(),
    number: `K1-261113-${String(++n).padStart(4, "0")}`,
    soldAt: (soldAt as Date).toISOString(),
    lines: [{ productId: cat, qty, unitPrice }],
    discount: discountBp ? { kind: "percent", value: discountBp } : { kind: "none", value: 0 },
    method: "cash",
    accountId: kas,
    tendered: total,
    total,
    ...(approval ? { approval } : {}),
  };
};
async function sell(cookie: string, body: ReturnType<typeof sale>) {
  const res = await post("/api/pos/sales", cookie, body);
  expect(res.status, await res.clone().text()).toBe(201);
  return body.id;
}

/** Audit rows written straight into the log, for days the API cannot backdate. */
async function logged(actorId: string, action: string, times: Date[], after: Record<string, unknown> = {}) {
  if (times.length === 0) return;
  await db.insert(auditEvents).values(
    times.map((time) => ({
      at: time,
      actorId,
      actorRole: "kasir" as const,
      source: "kasir" as const,
      action,
      entityType: "pos_sale",
      entityId: uuidv7(),
      summary: action,
      after,
    })),
  );
}
const times = (date: string, count: number) => Array.from({ length: count }, (_, i) => at(date, `10:${String(i).padStart(2, "0")}`));

describe("access", () => {
  it("is admin only", async () => {
    const { cookie: kasir } = await signIn("kasir", "kasir-akses");
    for (const cookie of [kasir, staff]) {
      expect((await call(`/api/watchdog?from=${today}&to=${today}`, { cookie })).status).toBe(403);
      expect((await call(`/api/watchdog/daily?date=${today}`, { cookie })).status).toBe(403);
      expect((await call("/api/settings/watchdog", { cookie })).status).toBe(403);
    }
    expect((await call(`/api/watchdog?from=${daysAgo(100)}&to=${today}`, { cookie: admin })).status).toBe(400);
  });

  it("keeps the watchdog settings away from the Kasir catalog and the shop header", async () => {
    const shop = (await (await call("/api/settings", { cookie: staff })).json()) as Record<string, unknown>;
    expect(shop).not.toHaveProperty("openTime");
    expect(await (await call("/api/settings/watchdog", { cookie: admin })).json()).toEqual({
      openTime: "07:00",
      closeTime: "17:00",
    });
  });
});

describe("voids, revisi and refunds above normal", () => {
  it("flags a cashier over max(3, 2 × their median), not one at their usual level", async () => {
    const { user: quiet } = await signIn("kasir", "kasir-jarang");
    const { user: busy } = await signIn("kasir", "kasir-sering");
    const day = daysAgo(40);
    await logged(quiet.id, "pos.sale.void", times(day, 4));
    await logged(quiet.id, "pos.sale.revise", times(day, 4), { difference: -10_000 });
    await logged(quiet.id, "pos.sale.revise", times(daysAgo(41), 3), { difference: -10_000 });
    // The busy cashier voids 5 a day, so 8 today is under 2 × 5.
    for (let i = 1; i <= 30; i++) await logged(busy.id, "pos.sale.void", times(addDays(day, -i), 5));
    await logged(busy.id, "pos.sale.void", times(day, 8));

    expect(whose(await flags("voids", day), quiet.id)).toEqual([
      expect.objectContaining({
        severity: "high",
        date: day,
        message: "4 void dalam sehari, biasanya 0",
        who: { id: quiet.id, name: quiet.name },
        target: { type: "audit", actorId: quiet.id, action: "pos.sale.void", date: day },
      }),
    ]);
    expect(whose(await flags("revisi", day), quiet.id)).toHaveLength(1);
    expect(whose(await flags("refunds", day), quiet.id)).toEqual([expect.objectContaining({ message: "4 refund dalam sehari, biasanya 0" })]);
    expect(whose(await flags("voids", day), busy.id)).toEqual([]);
    expect(whose(await flags("revisi", daysAgo(41)), quiet.id)).toEqual([]);
  });
});

describe("pricing", () => {
  it("flags an approved sale below cost, not one at the normal price", async () => {
    const { cookie, user } = await signIn("kasir", "kasir-modal");
    const below = await sell(cookie, sale({ unitPrice: 5_000, approval: { pin: PIN } }));
    await sell(cookie, sale());
    expect(whose(await flags("below_cost", today), user.id)).toEqual([
      expect.objectContaining({ severity: "high", target: { type: "pos_sale", id: below }, message: expect.stringMatching(/di bawah modal \(1 baris\)$/) }),
    ]);
  });

  it("flags a discount at the cap, not one 1% under it", async () => {
    const { cookie, user } = await signIn("kasir", "kasir-diskon");
    const atCap = await sell(cookie, sale({ discountBp: 500 }));
    await sell(cookie, sale({ discountBp: 400 }));
    expect(whose(await flags("discount_near_cap", today), user.id)).toEqual([
      expect.objectContaining({ severity: "medium", target: { type: "pos_sale", id: atCap }, message: expect.stringMatching(/diskon 5%, batas 5%$/) }),
    ]);
  });
});

describe("nota sementara", () => {
  const draft = async (cookie: string) => {
    const res = await post("/api/pos/drafts", cookie, { customerId: null, lines: [{ productId: cat, qty: 1, unitPrice: 10_000 }], discount: { kind: "none", value: 0 } });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; number: string };
  };

  it("flags one still open after an earlier day closed, not one cancelled unprinted", async () => {
    const { cookie, user } = await signIn("kasir", "kasir-nota");
    const day = daysAgo(10);
    const open = await draft(cookie);
    const cancelled = await draft(cookie);
    expect((await post(`/api/pos/drafts/${cancelled.id}/cancel`, cookie, { reason: "Batal" })).status).toBe(200);
    for (const id of [open.id, cancelled.id]) await db.update(posDrafts).set({ date: day }).where(eq(posDrafts.id, id));

    expect(whose(await flags("draft_open_after_close", day), user.id)).toEqual([
      expect.objectContaining({ message: `Nota sementara ${open.number} masih terbuka setelah jam tutup 17:00` }),
    ]);
    expect(whose(await flags("draft_cancelled_printed", today), user.id)).toEqual([]);
  });

  it("flags one cancelled after it was printed", async () => {
    const { cookie, user } = await signIn("kasir", "kasir-cetak");
    const printed = await draft(cookie);
    expect((await post(`/api/pos/drafts/${printed.id}/print`, cookie)).status).toBe(200);
    expect((await post(`/api/pos/drafts/${printed.id}/cancel`, cookie, { reason: "Batal", approval: { pin: PIN } })).status).toBe(200);
    expect(whose(await flags("draft_cancelled_printed", today), user.id)).toEqual([
      expect.objectContaining({ severity: "high", message: `Nota sementara ${printed.number} dibatalkan setelah dicetak 1×` }),
    ]);
  });
});

describe("activity outside opening hours", () => {
  it("flags activity after closing time, not during opening hours", async () => {
    const { user } = await signIn("kasir", "kasir-malam");
    await logged(user.id, "pos.sale.create", [at(daysAgo(20), "22:05"), at(daysAgo(20), "22:40")]);
    await logged(user.id, "pos.sale.create", [at(daysAgo(21), "10:00")]);
    expect(whose(await flags("outside_hours", daysAgo(20)), user.id)).toEqual([
      expect.objectContaining({ message: "2 aktivitas di luar jam buka 07:00–17:00 (22:05–22:40)", date: daysAgo(20) }),
    ]);
    expect(whose(await flags("outside_hours", daysAgo(21)), user.id)).toEqual([]);
  });
});

describe("logins and PIN", () => {
  const failLogin = (username: string) => post("/api/auth/login", "", { username, password: "salah-sekali" });

  it("flags 3 failed logins in a day, not 2", async () => {
    const { user: three } = await signIn("kasir", "kasir-lupa");
    const { user: two } = await signIn("kasir", "kasir-ragu");
    for (let i = 0; i < 3; i++) expect((await failLogin("kasir-lupa")).status).toBe(401);
    for (let i = 0; i < 2; i++) expect((await failLogin("kasir-ragu")).status).toBe(401);
    expect(whose(await flags("failed_logins", today), three.id)).toEqual([expect.objectContaining({ message: "3 kali gagal masuk" })]);
    expect(whose(await flags("failed_logins", today), two.id)).toEqual([]);
  });

  it("flags a PIN lockout, not a single wrong PIN", async () => {
    const { cookie: locked, user: lockedUser } = await signIn("kasir", "kasir-kunci");
    const { cookie: once, user: onceUser } = await signIn("kasir", "kasir-salah");
    for (let i = 0; i < 5; i++) expect((await post("/api/pos/sales", locked, sale({ unitPrice: 5_000, approval: { pin: "000000" } }))).status).toBe(403);
    expect((await post("/api/pos/sales", once, sale({ unitPrice: 5_000, approval: { pin: "000000" } }))).status).toBe(403);
    expect(whose(await flags("pin_lockout", today), lockedUser.id)).toEqual([expect.objectContaining({ severity: "high" })]);
    expect(whose(await flags("pin_lockout", today), onceUser.id)).toEqual([]);
  });
});

describe("device clock", () => {
  it("flags a sale timed an hour after the server received it, not one a minute late", async () => {
    const { cookie, user } = await signIn("kasir", "kasir-jam");
    const ahead = await sell(cookie, sale({ soldAt: new Date(Date.now() + 60 * 60_000) }));
    await sell(cookie, sale({ soldAt: new Date(Date.now() - 60_000) }));
    expect(whose(await flags("clock_tampering", today, addDays(today, 1)), user.id)).toEqual([
      expect.objectContaining({ target: { type: "pos_sale", id: ahead }, message: expect.stringMatching(/jam K1 terlalu cepat$/) }),
    ]);
  });
});

describe("stock opname", () => {
  async function postedOpname(counted: number) {
    const opname = (await (await post("/api/opnames", admin, { categoryId: null, note: "" })).json()) as { id: string };
    expect((await call(`/api/opnames/${opname.id}/lines`, { method: "PUT", cookie: admin, body: { lines: [{ productId: cat, countedQty: counted }] } })).status).toBe(200);
    expect((await post(`/api/opnames/${opname.id}/post`, admin)).status).toBe(200);
    return opname.id;
  }
  const stock = async () => ((await (await call(`/api/products/${cat}`, { cookie: admin })).json()) as { stock: number }).stock;

  it("flags a posted opname whose differences reach Rp 100.000 at cost, not a small one", async () => {
    const small = await postedOpname((await stock()) - 1);
    const large = await postedOpname((await stock()) - 20);
    const list = await flags("opname_difference", today);
    expect(list.map((f) => f.target)).toEqual([{ type: "opname", id: large }]);
    expect(list[0]).toMatchObject({ severity: "high", message: expect.stringMatching(/^Opname OP-\d{6}-\d{4} · 1 barang selisih · −Rp 120\.000$/) });
    expect(list.some((f) => f.target.type === "opname" && f.target.id === small)).toBe(false);
  });
});
