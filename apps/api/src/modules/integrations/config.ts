import type { AiProvider } from "@billy/core";
import { type Db, integrationSettings } from "@billy/db";
import { eq } from "drizzle-orm";
import { open } from "../../lib/secret-box.ts";

/** The default model per provider when the admin has not picked one. Claude's is Anthropic's current default. */
export const defaultModels: Record<AiProvider, string> = { anthropic: "claude-opus-5-5", openai: "" };

export interface Integrations {
  ai: { provider: AiProvider; model: string; apiKey: string | null; keys: Record<AiProvider, string | null> };
  telegram: { token: string | null; username: string; webhookSecret: string | null };
}

async function stored(db: Db) {
  const [row] = await db.select().from(integrationSettings).where(eq(integrationSettings.id, 1));
  return row ?? null;
}

/**
 * The connections in effect: what the admin saved in the web, and for anything not saved there, the
 * environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY, TELEGRAM_BOT_TOKEN, ...). Read per use, so a
 * change in the web applies to the next message without a restart.
 */
export async function loadIntegrations(db: Db): Promise<Integrations> {
  const row = await stored(db);
  const env = process.env;
  const keys = {
    anthropic: open(row?.anthropicApiKey ?? null) ?? env.ANTHROPIC_API_KEY ?? null,
    openai: open(row?.openaiApiKey ?? null) ?? env.OPENAI_API_KEY ?? null,
  };
  const provider = row?.aiProvider ?? "anthropic";
  const savedToken = open(row?.telegramBotToken ?? null);
  return {
    ai: { provider, model: row?.aiModel || defaultModels[provider], apiKey: keys[provider], keys },
    telegram: {
      token: savedToken ?? env.TELEGRAM_BOT_TOKEN ?? null,
      // A username saved with a token belongs to that token; the env pair goes together too.
      username: (savedToken ? row?.telegramBotUsername : env.TELEGRAM_BOT_USERNAME) ?? "",
      webhookSecret: open(row?.telegramWebhookSecret ?? null) ?? env.TELEGRAM_WEBHOOK_SECRET ?? null,
    },
  };
}

export { stored as storedIntegrations };
