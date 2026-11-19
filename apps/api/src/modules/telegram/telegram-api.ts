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

const LONG_POLL_SECONDS = 25;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One Bot API call with a deadline, so a connection that stalls (seen on flaky links to Telegram) fails
 * instead of hanging the bot. A network failure is retried up to `attempts` times; an answer from
 * Telegram saying no is not.
 */
async function call(method: string, body: Record<string, unknown>, { timeoutMs = 15_000, attempts = 3 } = {}) {
  const { token } = telegramConfig();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (attempt >= attempts) throw err;
      await sleep(1000 * attempt);
      continue;
    }
    const json = (await res.json()) as { ok: boolean; description?: string; result?: unknown };
    if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? res.status}`);
    return json.result;
  }
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
      const updates = (await call("getUpdates", { offset, timeout: LONG_POLL_SECONDS }, { timeoutMs: (LONG_POLL_SECONDS + 10) * 1000, attempts: 1 })) as {
        update_id: number;
      }[];
      for (const raw of updates) {
        offset = raw.update_id + 1;
        const update = telegramUpdate.safeParse(raw);
        if (update.success) await handleUpdate(db, update.data, liveBotDeps);
      }
    } catch (err) {
      console.error("Telegram polling failed, retrying in 2s:", err instanceof Error ? (err.cause ?? err.message) : err);
      await sleep(2000);
    }
  }
}
