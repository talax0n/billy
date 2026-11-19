import { auditEvents, categories, products, settings, stockOpnames, users } from "@billy/db";
import { and, eq, like } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestApp } from "../../testing.ts";
import type { Actor } from "../../env.ts";
import { type BotDeps, createLinkCode, handleUpdate } from "./bot.ts";
import { clearCounts, draftsSummary, findProducts, recordCounts } from "./stock-tools.ts";

const { app, call, signIn, db } = await createTestApp();
let staff: string;
let staffId: string;
let kasirId: string;
let dulux: string;
let nippon: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  ({ cookie: staff, user: { id: staffId } } = await signIn("staff"));
  ({ user: { id: kasirId } } = await signIn("kasir"));
  await db.insert(settings).values({ shopName: "Toko Uji", receiptFooter: "", posDeviceCode: "K1" });
  const [d, n] = await db.insert(categories).values([{ name: "Dulux" }, { name: "Nippon Paint" }]).returning({ id: categories.id });
  dulux = d!.id;
  nippon = n!.id;
  const rows = await db
    .insert(products)
    .values([
      { name: "WEATHERSHIELD BASE A GALON", unit: "GALON", categoryId: dulux },
      { name: "WEATHERSHIELD BASE A PAIL", unit: "PAIL", categoryId: dulux },
      { name: "PENTALITE BASE B PAIL", unit: "PAIL", categoryId: dulux },
      { name: "VINILEX 5000 PUTIH PAIL", unit: "PAIL", categoryId: nippon },
    ])
    .returning({ id: products.id, name: products.name });
  for (const r of rows) ids[r.name] = r.id;
});

const actor = (): Actor => ({ id: staffId, role: "staff", source: "telegram" });

describe("the stock bot's tools", () => {
  it("ranks a brand's products against what the staff typed", async () => {
    const found = await findProducts(db, dulux, "weathershield base a 2,5 liter");
    expect(found[0]!.name).toBe("WEATHERSHIELD BASE A GALON");
    expect(found.map((p) => p.name)).not.toContain("WEATHERSHIELD BASE A PAIL");
  });

  it("writes counts into one draft per brand, under the telegram source, and corrects them", async () => {
    const first = await recordCounts(db, actor(), dulux, [{ productId: ids["WEATHERSHIELD BASE A GALON"]!, qty: 6 }]);
    const second = await recordCounts(db, actor(), dulux, [
      { productId: ids["PENTALITE BASE B PAIL"]!, qty: 3 },
      { productId: ids["WEATHERSHIELD BASE A GALON"]!, qty: 7 },
    ]);
    expect(second.opname).toBe(first.opname);
    expect(second.saved).toEqual([
      { name: "PENTALITE BASE B PAIL", qty: 3 },
      { name: "WEATHERSHIELD BASE A GALON", qty: 7 },
    ]);
    expect(await clearCounts(db, actor(), dulux, [ids["PENTALITE BASE B PAIL"]!])).toEqual({ opname: first.opname, cleared: ["PENTALITE BASE B PAIL"] });

    const summary = await draftsSummary(db);
    expect(summary).toContain(`${first.opname} (Dulux), 1 barang dihitung:`);
    expect(summary).toContain("WEATHERSHIELD BASE A GALON");
    expect(summary).toContain("= 7");

    const [opname] = await db.select({ status: stockOpnames.status }).from(stockOpnames).where(eq(stockOpnames.number, first.opname));
    expect(opname!.status).toBe("draft");
    const events = await db
      .select({ action: auditEvents.action, source: auditEvents.source })
      .from(auditEvents)
      .where(and(eq(auditEvents.actorId, staffId), like(auditEvents.action, "stock.opname.%")));
    expect(new Set(events.map((e) => e.source))).toEqual(new Set(["telegram"]));
    expect(events.map((e) => e.action)).toContain("stock.opname.create");
  });

  it("refuses a product of another brand", async () => {
    await expect(recordCounts(db, actor(), dulux, [{ productId: ids["VINILEX 5000 PUTIH PAIL"]!, qty: 1 }])).rejects.toThrow("di luar cakupan");
  });
});

describe("the Telegram bot", () => {
  const sent: [string, string][] = [];
  const agent = vi.fn<BotDeps["agent"]>(async () => "✓ WEATHERSHIELD BASE A GALON: 6\nMasuk draf OP-1");
  const deps: BotDeps = { send: async (chatId, text) => void sent.push([chatId, text]), typing: async () => undefined, agent };
  let updateId = 1000;
  const message = (chatId: number, text: string) => handleUpdate(db, { update_id: updateId++, message: { chat: { id: chatId }, text } }, deps);
  afterEach(() => {
    sent.length = 0;
    agent.mockClear();
  });

  it("asks an unknown chat to link first, and links it with a fresh code", async () => {
    await message(11, "dulux weathershield A galon 6");
    expect(agent).not.toHaveBeenCalled();
    expect(sent[0]![1]).toContain("Hubungkan dulu");

    await message(11, "/start SALAH123");
    expect(sent[1]![1]).toContain("Kode tidak dikenal");

    const { code } = await createLinkCode(db, staffId);
    await message(11, `/start ${code.toLowerCase()}`);
    expect(sent[2]).toEqual(["11", expect.stringContaining("Terhubung sebagai Uji staff")]);
    await message(12, `/start ${code}`);
    expect(sent[3]![1]).toContain("Kode tidak dikenal");
  });

  it("hands a linked staff's message to the agent with the last reply, and remembers the new one", async () => {
    await message(11, "dulux weathershield A galon 6");
    await message(11, "1");
    expect(agent.mock.calls.map(([input]) => [input.text, input.lastReply, input.actor])).toEqual([
      ["dulux weathershield A galon 6", "", { id: staffId, role: "staff", source: "telegram" }],
      ["1", "✓ WEATHERSHIELD BASE A GALON: 6\nMasuk draf OP-1", { id: staffId, role: "staff", source: "telegram" }],
    ]);
    expect(sent.map(([, text]) => text)).toEqual(["✓ WEATHERSHIELD BASE A GALON: 6\nMasuk draf OP-1", "✓ WEATHERSHIELD BASE A GALON: 6\nMasuk draf OP-1"]);
  });

  it("handles an update Telegram resends only once", async () => {
    const update = { update_id: 5000, message: { chat: { id: 11 }, text: "pentalite B pail 3" } };
    await handleUpdate(db, update, deps);
    await handleUpdate(db, update, deps);
    expect(agent).toHaveBeenCalledTimes(1);
  });

  it("says so when the agent fails, instead of staying silent", async () => {
    agent.mockRejectedValueOnce(new Error("overloaded"));
    vi.spyOn(console, "error").mockImplementationOnce(() => undefined);
    await message(11, "pentalite B pail 3");
    expect(sent[0]![1]).toContain("belum tercatat");
  });

  it("does not take counts from a kasir or a deactivated account", async () => {
    await message(21, `/start ${(await createLinkCode(db, kasirId)).code}`);
    await message(21, "dulux pentalite B pail 3");
    expect(sent[1]![1]).toContain("Akun kasir tidak bisa");

    await db.update(users).set({ active: false }).where(eq(users.id, staffId));
    await message(11, "dulux pentalite B pail 3");
    expect(sent[2]![1]).toContain("Hubungkan dulu");
    await db.update(users).set({ active: true }).where(eq(users.id, staffId));
    expect(agent).not.toHaveBeenCalled();
  });
});

describe("Telegram routes", () => {
  it("only lets Telegram in with the webhook secret", async () => {
    const post = async (updateId: number, secret?: string) =>
      (
        await app.request("/api/telegram/webhook", {
          method: "POST",
          headers: { "content-type": "application/json", ...(secret && { "x-telegram-bot-api-secret-token": secret }) },
          body: JSON.stringify({ update_id: updateId }),
        })
      ).status;
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    expect(await post(9000, "apa-saja")).toBe(503);
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "rahasia-webhook");
    expect(await post(9001)).toBe(401);
    expect(await post(9002, "rahasia-salah")).toBe(401);
    expect(await post(9003, "rahasia-webhook")).toBe(200);
    vi.unstubAllEnvs();
  });

  it("gives the signed-in user a link code and shows whether their chat is linked", async () => {
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "TokoCatBot");
    const res = await call("/api/telegram/link", { method: "POST", cookie: staff });
    const body = (await res.json()) as { code: string; url: string };
    expect(res.status).toBe(201);
    expect(body.url).toBe(`https://t.me/TokoCatBot?start=${body.code}`);
    expect(await (await call("/api/telegram/link", { cookie: staff })).json()).toMatchObject({ linked: true, botUsername: "TokoCatBot" });
    await call("/api/telegram/link", { method: "DELETE", cookie: staff });
    expect(await (await call("/api/telegram/link", { cookie: staff })).json()).toMatchObject({ linked: false });
    vi.unstubAllEnvs();
  });
});
