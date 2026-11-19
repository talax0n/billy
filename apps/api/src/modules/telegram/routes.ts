import { timingSafeEqual } from "node:crypto";
import { telegramChats } from "@billy/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { backOffice } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { createLinkCode, handleUpdate, telegramUpdate } from "./bot.ts";
import { liveBotDeps, telegramConfig } from "./telegram-api.ts";

const sameSecret = (given: string, expected: string) =>
  given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));

/** The stock bot: Telegram's webhook, and linking the signed-in user's Telegram chat from Pengaturan. */
export const telegramRoutes = new Hono<AppEnv>()
  /**
   * Telegram calls this for every message, with the secret set at setWebhook in a header. It answers 200
   * once handled; a failure inside is answered to the chat, so Telegram has no reason to resend.
   */
  .post("/webhook", async (c) => {
    const { webhookSecret } = telegramConfig();
    if (!webhookSecret) return c.json({ error: "Bot Telegram belum diatur" }, 503);
    if (!sameSecret(c.req.header("x-telegram-bot-api-secret-token") ?? "", webhookSecret)) return c.json({ error: "Tidak diizinkan" }, 401);
    const update = telegramUpdate.safeParse(await c.req.json().catch(() => null));
    if (update.success) await handleUpdate(c.var.db, update.data, liveBotDeps);
    return c.json({ ok: true });
  })
  .get("/link", backOffice(), async (c) => {
    const [chat] = await c.var.db.select({ linkedAt: telegramChats.linkedAt }).from(telegramChats).where(eq(telegramChats.userId, c.var.user.id));
    return c.json({ linked: Boolean(chat), linkedAt: chat?.linkedAt.toISOString() ?? null, botUsername: telegramConfig().username ?? null });
  })
  .post("/link", backOffice(), async (c) => {
    const { code, minutes } = await createLinkCode(c.var.db, c.var.user.id);
    const { username } = telegramConfig();
    return c.json({ code, minutes, url: username ? `https://t.me/${username}?start=${code}` : null }, 201);
  })
  .delete("/link", backOffice(), async (c) => {
    await c.var.db.delete(telegramChats).where(eq(telegramChats.userId, c.var.user.id));
    return c.json({ linked: false });
  });
