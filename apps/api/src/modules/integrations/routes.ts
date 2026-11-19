import { randomBytes } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { aiConnectionTestInput, type AiProvider, DomainError, integrationsInput, telegramWebhookInput } from "@billy/core";
import { integrationSettings } from "@billy/db";
import { Hono } from "hono";
import OpenAI from "openai";
import { adminOnly } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { audit } from "../../lib/audit.ts";
import { hint, open, seal } from "../../lib/secret-box.ts";
import { validate } from "../../lib/validate.ts";
import { telegramCall } from "../telegram/telegram-api.ts";
import { defaultModels, loadIntegrations, storedIntegrations } from "./config.ts";

/** Where a secret in effect comes from: saved in the web, an environment variable, or nowhere. */
const source = (saved: string | null, inEffect: string | null): "web" | "env" | null => (open(saved) ? "web" : inEffect ? "env" : null);

/** Models a key can use, newest first: proves the key works and gives the admin a list to pick from. */
async function listModels(provider: AiProvider, apiKey: string) {
  try {
    if (provider === "anthropic") {
      const page = await new Anthropic({ apiKey, maxRetries: 0, timeout: 15_000 }).models.list({ limit: 50 });
      return page.data.map((m) => m.id);
    }
    const page = await new OpenAI({ apiKey, maxRetries: 0, timeout: 15_000 }).models.list();
    return page.data
      .sort((a, b) => b.created - a.created)
      .map((m) => m.id)
      .slice(0, 80);
  } catch (err) {
    const status = err instanceof Anthropic.APIError || err instanceof OpenAI.APIError ? err.status : undefined;
    if (status === 401 || status === 403) throw new DomainError("invalid", "Kunci API ditolak. Periksa lagi kuncinya.");
    throw new DomainError("invalid", `Tidak bisa tersambung ke ${provider === "anthropic" ? "Anthropic" : "OpenAI"}. Coba lagi sebentar.`);
  }
}

async function botUsername(token: string) {
  try {
    const me = (await telegramCall(token, "getMe", {}, { attempts: 2 })) as { username: string };
    return me.username;
  } catch {
    throw new DomainError("invalid", "Token bot ditolak Telegram, atau Telegram tidak bisa dihubungi. Periksa tokennya.");
  }
}

async function requireToken(c: { var: AppEnv["Variables"] }) {
  const { token } = (await loadIntegrations(c.var.db)).telegram;
  if (!token) throw new DomainError("invalid", "Isi dan simpan token bot Telegram dulu");
  return token;
}

/**
 * The AI and Telegram connections, set by the admin in the web. Secrets are write-only: they are stored
 * encrypted and only their last four characters ever come back.
 */
export const integrationRoutes = new Hono<AppEnv>()
  .use(adminOnly())
  .get("/", async (c) => {
    const row = await storedIntegrations(c.var.db);
    const live = await loadIntegrations(c.var.db);
    return c.json({
      aiProvider: live.ai.provider,
      aiModel: row?.aiModel ?? "",
      defaultModels,
      keys: {
        anthropic: { hint: hint(live.ai.keys.anthropic), source: source(row?.anthropicApiKey ?? null, live.ai.keys.anthropic) },
        openai: { hint: hint(live.ai.keys.openai), source: source(row?.openaiApiKey ?? null, live.ai.keys.openai) },
      },
      telegram: {
        token: { hint: hint(live.telegram.token), source: source(row?.telegramBotToken ?? null, live.telegram.token) },
        username: live.telegram.username || null,
      },
      canStoreSecrets: Boolean(process.env.BILLY_SECRET_KEY),
      suggestedWebhookUrl: `${new URL(c.req.url).origin}/api/telegram/webhook`,
    });
  })
  .put("/", validate("json", integrationsInput), async (c) => {
    const input = c.req.valid("json");
    const before = await storedIntegrations(c.var.db);
    const sealOrClear = (value: string | null | undefined, current: string | null) => (value === undefined ? current : value === null ? null : seal(value));
    const username = input.telegramBotToken ? await botUsername(input.telegramBotToken) : input.telegramBotToken === null ? "" : (before?.telegramBotUsername ?? "");
    const values = {
      aiProvider: input.aiProvider,
      aiModel: input.aiModel,
      anthropicApiKey: sealOrClear(input.anthropicApiKey, before?.anthropicApiKey ?? null),
      openaiApiKey: sealOrClear(input.openaiApiKey, before?.openaiApiKey ?? null),
      telegramBotToken: sealOrClear(input.telegramBotToken, before?.telegramBotToken ?? null),
      telegramBotUsername: username,
      updatedBy: c.var.actor.id,
      updatedAt: new Date(),
    };
    // Secrets go to the log only as "changed" or "removed", never their value.
    const secretChange = (value: string | null | undefined) => (value === undefined ? undefined : value === null ? "dihapus" : "diganti");
    await c.var.db.transaction(async (tx) => {
      await tx.insert(integrationSettings).values({ id: 1, ...values }).onConflictDoUpdate({ target: integrationSettings.id, set: values });
      await audit(tx, c.var.actor, {
        action: "settings.integrations.update",
        entityId: c.var.actor.id,
        summary: `Koneksi diubah · AI ${input.aiProvider === "anthropic" ? "Claude" : "ChatGPT"}${input.aiModel ? ` ${input.aiModel}` : ""}`,
        before: { aiProvider: before?.aiProvider ?? null, aiModel: before?.aiModel ?? null, telegramBotUsername: before?.telegramBotUsername ?? null },
        after: {
          aiProvider: input.aiProvider,
          aiModel: input.aiModel,
          telegramBotUsername: username,
          anthropicApiKey: secretChange(input.anthropicApiKey),
          openaiApiKey: secretChange(input.openaiApiKey),
          telegramBotToken: secretChange(input.telegramBotToken),
        },
      });
    });
    return c.json({ ok: true, telegramBotUsername: username || null });
  })
  .post("/ai/test", validate("json", aiConnectionTestInput), async (c) => {
    const { provider, apiKey } = c.req.valid("json");
    const key = apiKey ?? (await loadIntegrations(c.var.db)).ai.keys[provider];
    if (!key) throw new DomainError("invalid", "Isi kunci API dulu");
    return c.json({ models: await listModels(provider, key) });
  })
  .get("/telegram/webhook", async (c) => {
    const info = (await telegramCall(await requireToken(c), "getWebhookInfo", {})) as { url: string; pending_update_count: number; last_error_message?: string };
    return c.json({ url: info.url || null, pending: info.pending_update_count, lastError: info.last_error_message ?? null });
  })
  /** Points Telegram at this server, with a fresh secret header so only Telegram can call the webhook. */
  .put("/telegram/webhook", validate("json", telegramWebhookInput), async (c) => {
    const { url } = c.req.valid("json");
    if (!url.startsWith("https://")) throw new DomainError("invalid", "Telegram hanya mengirim ke alamat https://");
    const token = await requireToken(c);
    const secret = randomBytes(24).toString("hex");
    await telegramCall(token, "setWebhook", { url, secret_token: secret, allowed_updates: ["message"] });
    const sealed = seal(secret);
    await c.var.db
      .insert(integrationSettings)
      .values({ id: 1, telegramWebhookSecret: sealed, updatedBy: c.var.actor.id })
      .onConflictDoUpdate({ target: integrationSettings.id, set: { telegramWebhookSecret: sealed, updatedBy: c.var.actor.id, updatedAt: new Date() } });
    return c.json({ url });
  })
  .delete("/telegram/webhook", async (c) => {
    await telegramCall(await requireToken(c), "deleteWebhook", {});
    return c.json({ url: null });
  });
