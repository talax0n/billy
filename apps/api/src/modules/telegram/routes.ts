import { timingSafeEqual } from "node:crypto";
import { telegramChats } from "@billy/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { backOffice } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { createLinkCode, handleUpdate, telegramUpdate } from "./bot.ts";
import { loadIntegrations } from "../integrations/config.ts";
import { liveBotDeps } from "./telegram-api.ts";

const sameSecret = (given: string, expected: string) =>
  given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));

/** The stock bot: Telegram's webhook, and linking the signed-in user's Telegram chat from Pengaturan. */
export const telegramRoutes = new Hono<AppEnv>()
  /**
   * Telegram calls this for every message, with the secret set at setWebhook in a header. It answers 200
   * once handled; a failure inside is answered to the chat, so Telegram has no reason to resend.
   */
  .post("/webhook", async (c) => {
    const integrations = await loadIntegrations(c.var.db);
    const { webhookSecret, token } = integrations.telegram;
    if (!webhookSecret || !token) return c.json({ error: "Bot Telegram belum diatur" }, 503);
    if (!sameSecret(c.req.header("x-telegram-bot-api-secret-token") ?? "", webhookSecret)) return c.json({ error: "Tidak diizinkan" }, 401);
    const update = telegramUpdate.safeParse(await c.req.json().catch(() => null));
    if (update.success) await handleUpdate(c.var.db, update.data, liveBotDeps(integrations));
    return c.json({ ok: true });
  })
  .get("/link", backOffice(), async (c) => {
    const [chat] = await c.var.db.select({ linkedAt: telegramChats.linkedAt }).from(telegramChats).where(eq(telegramChats.userId, c.var.user.id));
    const { username } = (await loadIntegrations(c.var.db)).telegram;
    return c.json({ linked: Boolean(chat), linkedAt: chat?.linkedAt.toISOString() ?? null, botUsername: username || null });
  })
  .post("/link", backOffice(), async (c) => {
    const { code, minutes } = await createLinkCode(c.var.db, c.var.user.id);
    const { username } = (await loadIntegrations(c.var.db)).telegram;
    return c.json({ code, minutes, url: username ? `https://t.me/${username}?start=${code}` : null }, 201);
  })
  .delete("/link", backOffice(), async (c) => {
    await c.var.db.delete(telegramChats).where(eq(telegramChats.userId, c.var.user.id));
    return c.json({ linked: false });
  });
