import type { Db } from "@billy/db";
import { runStockAgent } from "./agent.ts";
import { type BotDeps, handleUpdate, telegramUpdate } from "./bot.ts";

/**
 * Telegram settings, read per call so a deploy picks up new env values. TELEGRAM_BOT_TOKEN talks to
 * Telegram; TELEGRAM_WEBHOOK_SECRET is the header Telegram sends back on every webhook call;
 * TELEGRAM_BOT_USERNAME builds the t.me link shown in Pengaturan.
 */
export const telegramConfig = () => ({
  token: process.env.TELEGRAM_BOT_TOKEN,
  webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
  username: process.env.TELEGRAM_BOT_USERNAME,
});

async function call(method: string, body: Record<string, unknown>) {
  const { token } = telegramConfig();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; description?: string; result?: unknown };
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? res.status}`);
  return json.result;
}

export const liveBotDeps: BotDeps = {
  send: async (chatId, text) => void (await call("sendMessage", { chat_id: chatId, text })),
  typing: async (chatId) => void (await call("sendChatAction", { chat_id: chatId, action: "typing" })),
  agent: (input) => runStockAgent(input),
};

/**
 * Local development has no public URL for the webhook, so `dev.ts` long-polls instead when a bot token
 * is set. getUpdates refuses while a webhook is registered, so this drops it first: do not run it with
 * the production bot's token.
 */
export async function pollTelegram(db: Db) {
  let offset = 0;
  let webhookCleared = false;
  for (;;) {
    try {
      if (!webhookCleared) {
        await call("deleteWebhook", {});
        webhookCleared = true;
        console.log("Telegram bot: polling for messages");
      }
      const updates = (await call("getUpdates", { offset, timeout: 30 })) as { update_id: number }[];
      for (const raw of updates) {
        offset = raw.update_id + 1;
        const update = telegramUpdate.safeParse(raw);
        if (update.success) await handleUpdate(db, update.data, liveBotDeps);
      }
    } catch (err) {
      console.error("Telegram polling failed, retrying in 5s", err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
