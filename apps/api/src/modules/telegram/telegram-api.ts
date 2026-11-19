import type { Db } from "@billy/db";
import { type Integrations, loadIntegrations } from "../integrations/config.ts";
import { runStockAgent } from "./agent.ts";
import { type BotDeps, handleUpdate, telegramUpdate } from "./bot.ts";

const LONG_POLL_SECONDS = 25;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One Bot API call with a deadline, so a connection that stalls (seen on flaky links to Telegram) fails
 * instead of hanging the bot. A network failure is retried up to `attempts` times; an answer from
 * Telegram saying no is not.
 */
export async function telegramCall(token: string, method: string, body: Record<string, unknown>, { timeoutMs = 15_000, attempts = 3 } = {}) {
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

/** Lists `/menu` in Telegram's command menu, so the button menu is one tap away even after it is hidden. */
export const registerCommands = (token: string) => telegramCall(token, "setMyCommands", { commands: [{ command: "menu", description: "Tampilkan menu" }] });

/** The bot's live connections for one update: this token for Telegram, the configured AI for the agent. */
export function liveBotDeps(integrations: Integrations): BotDeps {
  const token = integrations.telegram.token!;
  return {
    send: async (chatId, text, markup) => void (await telegramCall(token, "sendMessage", { chat_id: chatId, text, ...(markup && { reply_markup: markup }) })),
    answerCallback: async (callbackId) => void (await telegramCall(token, "answerCallbackQuery", { callback_query_id: callbackId }, { attempts: 1 })),
    typing: async (chatId) => void (await telegramCall(token, "sendChatAction", { chat_id: chatId, action: "typing" })),
    agent: (input) => runStockAgent(input, integrations.ai),
    download: async (fileId, mediaType) => {
      const file = (await telegramCall(token, "getFile", { file_id: fileId })) as { file_path: string };
      const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`Telegram file download: ${res.status}`);
      return { mediaType, data: Buffer.from(await res.arrayBuffer()).toString("base64") };
    },
  };
}

/**
 * Local development has no public URL for the webhook, so `dev.ts` long-polls instead. It reads the token
 * each round, so a token saved in the web starts the bot without a restart. getUpdates refuses while a
 * webhook is registered, so polling drops it first: do not poll with the production bot's token.
 */
export async function pollTelegram(db: Db) {
  let offset = 0;
  let pollingToken: string | null = null;
  for (;;) {
    try {
      const integrations = await loadIntegrations(db);
      const { token } = integrations.telegram;
      if (!token) {
        pollingToken = null;
        await sleep(15_000);
        continue;
      }
      if (token !== pollingToken) {
        await telegramCall(token, "deleteWebhook", {});
        await registerCommands(token);
        pollingToken = token;
        offset = 0;
        console.log("Telegram bot: polling for messages");
      }
      const updates = (await telegramCall(token, "getUpdates", { offset, timeout: LONG_POLL_SECONDS }, { timeoutMs: (LONG_POLL_SECONDS + 10) * 1000, attempts: 1 })) as {
        update_id: number;
      }[];
      for (const raw of updates) {
        offset = raw.update_id + 1;
        const update = telegramUpdate.safeParse(raw);
        if (update.success) await handleUpdate(db, update.data, liveBotDeps(integrations));
      }
    } catch (err) {
      console.error("Telegram polling failed, retrying in 2s:", err instanceof Error ? (err.cause ?? err.message) : err);
      await sleep(2000);
    }
  }
}
