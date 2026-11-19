import { accounts, auditEvents, categories, contacts, products, settings, stockMovements, stockOpnameLines, stockOpnames, users } from "@billy/db";
import { rupiah } from "@billy/core";
import { and, eq, like } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestApp } from "../../testing.ts";
import type { Actor } from "../../env.ts";
import { type BotDeps, createLinkCode, handleUpdate } from "./bot.ts";
import { confirmPending, prepareCounts } from "./pending.ts";
import { dailySummary, deliveriesToday, receivables, stockHistory, stockLookup } from "./query-tools.ts";
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
/** The counted quantity of a product in the open Dulux draft, or null. */
const countOf = async (productId: string) => {
  const [line] = await db
    .select({ qty: stockOpnameLines.countedQty })
    .from(stockOpnameLines)
    .innerJoin(stockOpnames, eq(stockOpnames.id, stockOpnameLines.opnameId))
    .where(and(eq(stockOpnameLines.productId, productId), eq(stockOpnames.status, "draft")));
  return line?.qty ?? null;
};

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

describe("the bot's read-only answers", () => {
  it("shows current stock of the closest products, with the cost price for admin only", async () => {
    await db.insert(stockMovements).values({
      productId: ids["WEATHERSHIELD BASE A GALON"]!,
      date: "2026-11-01",
      qty: 12,
      reason: "adjustment",
      unitCost: rupiah(0),
      createdBy: staffId,
      note: "stok awal",
    });
    const [staffView] = await stockLookup(db, "staff", "weathershield base a galon");
    expect(staffView).toMatchObject({ nama: "WEATHERSHIELD BASE A GALON", stok: 12 });
    expect(staffView).not.toHaveProperty("harga_modal");
    const [adminView] = await stockLookup(db, "admin", "weathershield base a galon", dulux);
    expect(adminView).toHaveProperty("harga_modal");
  });

  it("lists a product's movements newest first with the stock after each", async () => {
    const history = await stockHistory(db, ids["WEATHERSHIELD BASE A GALON"]!);
    expect(history[0]).toMatchObject({ tanggal: "2026-11-01", jumlah: 12, jenis: "penyesuaian/opname", catatan: "stok awal", stok_setelah: 12 });
    await expect(stockHistory(db, "00000000-0000-7000-8000-000000000000")).rejects.toThrow("Barang tidak ditemukan");
  });

  it("shows piutang per customer and the faktur of one customer", async () => {
    await db.insert(accounts).values({ code: "KAS", name: "Kas Toko", kind: "cash" });
    const [toko] = await db.insert(contacts).values({ code: "P-001", name: "Toko Bangun Jaya", kind: "customer", paymentTermsDays: 30 }).returning();
    const res = await call("/api/sales", {
      method: "POST",
      cookie: staff,
      body: { customerId: toko!.id, date: "2026-11-01", termsDays: 7, discountKind: "percent", discountValue: 0, note: "", lines: [{ productId: ids["PENTALITE BASE B PAIL"]!, qty: 2, unitPrice: 50_000 }] },
    });
    expect(res.status).toBe(201);
    expect(await receivables(db)).toMatchObject({ total_piutang: 100_000, pelanggan: [{ pelanggan: "Toko Bangun Jaya", total: 100_000, jumlah_faktur: 1 }] });
    expect((await receivables(db, "bangun")).pelanggan).toEqual([
      {
        pelanggan: "Toko Bangun Jaya",
        total: 100_000,
        jumlah_faktur: 1,
        lewat_tempo: 100_000,
        faktur_paling_lama: [expect.objectContaining({ tanggal: "2026-11-01", jatuh_tempo: "2026-11-08", sisa: 100_000 })],
      },
    ]);
    expect((await receivables(db, "tidak ada")).pelanggan).toEqual([]);
  });

  it("lists today's deliveries, and keeps the money summary for admin", async () => {
    expect(await deliveriesToday(db)).toEqual([]);
    await expect(dailySummary(db, "staff")).rejects.toThrow("hanya untuk admin");
    expect(await dailySummary(db, "admin")).toMatchObject({ penjualan: expect.any(Number), saldo: [{ akun: "Kas Toko" }] });
  });
});

describe("the Telegram bot", () => {
  const sent: [string, string][] = [];
  const markups: unknown[] = [];
  const cleared: number[] = [];
  const agent = vi.fn<BotDeps["agent"]>(async () => "✓ WEATHERSHIELD BASE A GALON: 6\nMasuk draf OP-1");
  const download = vi.fn<BotDeps["download"]>(async (fileId, mediaType) => ({ mediaType, data: `base64-of-${fileId}` }));
  const deps: BotDeps = {
    send: async (chatId, text, markup) => {
      sent.push([chatId, text]);
      markups.push(markup);
    },
    answerCallback: async () => undefined,
    clearButtons: async (_chatId, messageId) => void cleared.push(messageId),
    typing: async () => undefined,
    agent,
    download,
  };
  let updateId = 1000;
  const message = (chatId: number, text: string) => handleUpdate(db, { update_id: updateId++, message: { chat: { id: chatId }, text } }, deps);
  afterEach(() => {
    sent.length = 0;
    markups.length = 0;
    cleared.length = 0;
    agent.mockClear();
    download.mockClear();
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
    expect(markups[2]).toMatchObject({ keyboard: expect.any(Array), is_persistent: true });
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

  it("reads the largest size of a photo, with its caption as the message", async () => {
    await handleUpdate(
      db,
      {
        update_id: updateId++,
        message: { chat: { id: 11 }, caption: "SPB dulux", photo: [{ file_id: "kecil", file_size: 900 }, { file_id: "besar", file_size: 90_000 }] },
      },
      deps,
    );
    expect(download).toHaveBeenCalledWith("besar", "image/jpeg");
    expect(agent.mock.calls[0]![0]).toMatchObject({ text: "SPB dulux", images: [{ mediaType: "image/jpeg", data: "base64-of-besar" }] });
  });

  it("takes an image sent as a file, refuses one too big, and ignores other files", async () => {
    const doc = (mime_type: string, file_size: number) =>
      handleUpdate(db, { update_id: updateId++, message: { chat: { id: 11 }, document: { file_id: "dok", mime_type, file_size } } }, deps);
    await doc("image/png", 200_000);
    expect(agent.mock.calls[0]![0]).toMatchObject({ text: "", images: [{ mediaType: "image/png" }] });
    await doc("image/jpeg", 8 * 1024 * 1024);
    expect(sent.at(-1)![1]).toContain("terlalu besar");
    await doc("application/pdf", 1000);
    expect(agent).toHaveBeenCalledTimes(1);
  });

  it("brings the menu back with /start or /menu once linked", async () => {
    await message(11, "/start");
    await message(11, "/menu");
    expect(sent.map(([, text]) => text.split("\n")[0])).toEqual(["Lapor sisa stok dari SPB, misalnya:", "Lapor sisa stok dari SPB, misalnya:"]);
    expect(markups[1]).toMatchObject({ is_persistent: true });
  });

  it("answers menu buttons straight from billy, without the AI", async () => {
    await message(11, "🚚 Antaran");
    await message(11, "🧾 Piutang");
    await message(11, "📊 Ringkasan");
    await message(11, "📦 Cek stok");
    expect(agent).not.toHaveBeenCalled();
    expect(sent.map(([, text]) => text.split("\n")[0])).toEqual(["Tidak ada antaran hari ini.", expect.stringMatching(/^(Piutang Rp|Tidak ada piutang)/), "Ringkasan hanya untuk admin.", expect.stringContaining("Ketik nama barang")]);
  });

  it("puts a button under each numbered option, and a tap answers like typing the number", async () => {
    agent.mockResolvedValueOnce("**Catylac glow 3, yang mana?**\n1. CATYLAC GLOW BASE A GALON\n2. CATYLAC GLOW BASE B GALON");
    await message(11, "catylac glow sisa 3");
    expect(sent[0]![1]).toBe("Catylac glow 3, yang mana?\n1. CATYLAC GLOW BASE A GALON\n2. CATYLAC GLOW BASE B GALON");
    expect(markups[0]).toMatchObject({ inline_keyboard: [[{ callback_data: "pilih:1" }], [{ callback_data: "pilih:2" }]] });

    await handleUpdate(db, { update_id: updateId++, callback_query: { id: "tap-1", data: "pilih:2", message: { message_id: 501, chat: { id: 11 } } } }, deps);
    expect(agent.mock.calls[1]![0]).toMatchObject({ text: "2", lastReply: expect.stringContaining("yang mana?") });
  });

  it("saves nothing the agent prepares until the user taps Simpan, then saves it once", async () => {
    const galon = ids["WEATHERSHIELD BASE A GALON"]!;
    agent.mockImplementationOnce(async ({ chatId }) => {
      await prepareCounts(db, chatId, dulux, [{ productId: galon, qty: 9 }]);
      return "";
    });
    await message(11, "dulux weathershield A galon 9");
    expect(sent.map(([, t]) => t)).toEqual(["Simpan ke draf opname Dulux?\n✓ WEATHERSHIELD BASE A GALON: 9"]);
    const buttons = (markups[0] as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard[0]!;
    expect(buttons.map((b) => b.text)).toEqual(["✅ Simpan", "✖️ Batal"]);
    expect(await countOf(galon)).not.toBe(9);

    const tap = (data: string) => handleUpdate(db, { update_id: updateId++, callback_query: { id: "t", data, message: { message_id: 777, chat: { id: 11 } } } }, deps);
    await tap(buttons[0]!.callback_data);
    expect(sent[1]![1]).toMatch(/^Tersimpan di draf OP-\d{6}-\d{4}\n✓ WEATHERSHIELD BASE A GALON: 9$/);
    expect(cleared).toEqual([777]);
    expect(await countOf(galon)).toBe(9);
    await tap(buttons[0]!.callback_data);
    expect(sent[2]![1]).toContain("Tidak ada yang menunggu");
    expect(agent).toHaveBeenCalledTimes(1);
  });

  it("updates the prepared list on a correction, takes a typed yes, and refuses an older button", async () => {
    const galon = ids["WEATHERSHIELD BASE A GALON"]!;
    const pail = ids["PENTALITE BASE B PAIL"]!;
    const first = await prepareCounts(db, "11", dulux, [{ productId: galon, qty: 4 }, { productId: pail, qty: 2 }]);
    const corrected = await prepareCounts(db, "11", dulux, [{ productId: pail, qty: 5 }]);
    expect(corrected.counts.map((c) => [c.name, c.qty])).toEqual([["WEATHERSHIELD BASE A GALON", 4], ["PENTALITE BASE B PAIL", 5]]);
    expect(await confirmPending(db, "11", actor(), first.nonce)).toContain("kedaluwarsa");
    await message(11, "ya");
    expect(sent[0]![1]).toContain("✓ PENTALITE BASE B PAIL: 5");
    expect(await countOf(pail)).toBe(5);
    expect(agent).not.toHaveBeenCalled();
  });

  it("saves nothing on Batal", async () => {
    const galon = ids["WEATHERSHIELD BASE A GALON"]!;
    const before = await countOf(galon);
    await prepareCounts(db, "11", dulux, [{ productId: galon, qty: 1 }]);
    await message(11, "batal");
    expect(sent[0]![1]).toBe("Dibatalkan, tidak ada yang disimpan.");
    expect(await countOf(galon)).toBe(before);
  });

  it("refuses to prepare a product of another brand", async () => {
    await expect(prepareCounts(db, "11", dulux, [{ productId: ids["VINILEX 5000 PUTIH PAIL"]!, qty: 1 }])).rejects.toThrow("bukan produk aktif brand Dulux");
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
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456789:AAH-uji-token-bot-telegram-yang-panjang");
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
