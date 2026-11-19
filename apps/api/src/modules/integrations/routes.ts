import { randomBytes } from "node:crypto";
import { chatgptSessionInput, DomainError, integrationsInput, telegramWebhookInput } from "@billy/core";
import { type Db, integrationSettings } from "@billy/db";
import { Hono } from "hono";
import { adminOnly } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { audit } from "../../lib/audit.ts";
import { authorizeUrl, awaitCallback, ChatgptSignInRequired, decodeSessionCode, exchangeCode, newAttempt, refreshSession } from "../../lib/chatgpt-oauth.ts";
import { hint, open, seal } from "../../lib/secret-box.ts";
import { validate } from "../../lib/validate.ts";
import { registerCommands, telegramCall } from "../telegram/telegram-api.ts";
import { aiBearer, chatgptHostId, loadIntegrations, saveChatgptSession, storedIntegrations } from "./config.ts";

/** Where a secret in effect comes from: saved in the web, an environment variable, or nowhere. */
const source = (saved: string | null, inEffect: string | null): "web" | "env" | null => (open(saved) ? "web" : inEffect ? "env" : null);

/**
 * Models the current ChatGPT sign-in or API key can use. ChatGPT plan usage answers `{ models: [{ slug,
 * visibility }] }`, an API key the usual `{ data: [{ id }] }`.
 */
async function listModels(db: Db) {
  let token: string | null;
  try {
    token = await aiBearer(db);
  } catch (err) {
    if (err instanceof ChatgptSignInRequired) throw new DomainError("invalid", err.message);
    throw err;
  }
  if (!token) throw new DomainError("invalid", "Masuk dengan ChatGPT atau isi kunci OpenAI dulu");
  const res = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res) throw new DomainError("invalid", "OpenAI tidak bisa dihubungi. Coba lagi sebentar.");
  if (res.status === 401 || res.status === 403) throw new DomainError("invalid", "OpenAI menolak akses. Masuk lagi dengan ChatGPT atau periksa kuncinya.");
  const body = (await res.json()) as { models?: { slug: string; visibility?: string }[]; data?: { id: string; created: number }[] };
  if (body.models) return body.models.filter((m) => !m.visibility || m.visibility === "list").map((m) => m.slug);
  return (body.data ?? []).sort((a, b) => b.created - a.created).map((m) => m.id);
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
 * A sign-in started from the web. The callback listener runs inside this API process, so this only
 * works when the API runs on the same computer as the admin's browser (local use, the desktop app).
 * A hosted server takes a session code from `pnpm --filter @billy/api chatgpt:login` instead.
 */
let localSignIn: { url: string; status: "waiting" | "done" | "failed"; message: string } | null = null;

/**
 * The AI and Telegram connections, set by the admin in the web. Secrets are write-only: they are stored
 * encrypted and only their last four characters (or the ChatGPT account's email) ever come back.
 */
export const integrationRoutes = new Hono<AppEnv>()
  .use(adminOnly())
  .get("/", async (c) => {
    const row = await storedIntegrations(c.var.db);
    const live = await loadIntegrations(c.var.db);
    const apiKey = open(row?.openaiApiKey ?? null) ?? process.env.OPENAI_API_KEY ?? null;
    return c.json({
      aiModel: live.ai.model,
      aiAuth: live.ai.auth,
      chatgpt: live.ai.auth?.kind === "chatgpt" ? { email: live.ai.auth.email } : null,
      openaiKey: { hint: hint(apiKey), source: source(row?.openaiApiKey ?? null, apiKey) },
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
      aiModel: input.aiModel,
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
        summary: `Koneksi diubah · model ${input.aiModel || "belum dipilih"}`,
        before: { aiModel: before?.aiModel ?? null, telegramBotUsername: before?.telegramBotUsername ?? null },
        after: { aiModel: input.aiModel, telegramBotUsername: username, openaiApiKey: secretChange(input.openaiApiKey), telegramBotToken: secretChange(input.telegramBotToken) },
      });
    });
    return c.json({ ok: true, telegramBotUsername: username || null });
  })
  .get("/ai/models", async (c) => c.json({ models: await listModels(c.var.db) }))
  /** Starts a sign-in whose callback this API process receives on 127.0.0.1:1455; the web opens `url`. */
  .post("/chatgpt/login", async (c) => {
    if (localSignIn?.status === "waiting") return c.json(localSignIn);
    const db = c.var.db;
    const actorId = c.var.actor.id;
    const row = await storedIntegrations(db);
    const previous = JSON.parse(open(row?.chatgptSession ?? null) ?? "null") as { clientId: string; idToken: string } | null;
    const attempt = newAttempt();
    const callback = awaitCallback(attempt, { previousClientId: previous?.clientId ?? null });
    const current = { url: authorizeUrl(attempt, await chatgptHostId(db), previous), status: "waiting" as const, message: "" };
    localSignIn = current;
    void callback
      .then(async ({ code, clientId }) => {
        const session = await exchangeCode(clientId, code, attempt);
        await saveChatgptSession(db, session, actorId);
        await audit(db, { id: actorId, role: "admin", source: "web" }, { action: "settings.integrations.update", entityId: actorId, summary: `Masuk dengan ChatGPT${session.email ? ` sebagai ${session.email}` : ""}` });
        localSignIn = { ...current, status: "done", message: session.email ?? "" };
      })
      .catch((err: unknown) => {
        localSignIn = { ...current, status: "failed", message: err instanceof Error && "code" in err && err.code === "EADDRINUSE" ? "Port 1455 sedang dipakai aplikasi lain" : err instanceof Error ? err.message : "Gagal masuk" };
      });
    return c.json(current);
  })
  .get("/chatgpt/login", async (c) => c.json(localSignIn))
  /** A session signed in on another computer and pasted here; checked by refreshing it once, so this server owns it from now on. */
  .post("/chatgpt/session", validate("json", chatgptSessionInput), async (c) => {
    const pasted = decodeSessionCode(c.req.valid("json").code);
    if (!pasted) throw new DomainError("invalid", "Kode sesi tidak dikenali. Salin lengkap dari perintah chatgpt:login.");
    let session;
    try {
      session = await refreshSession(pasted);
    } catch (err) {
      throw new DomainError("invalid", err instanceof ChatgptSignInRequired ? "Sesi ini sudah tidak berlaku. Masuk lagi lalu tempel kode yang baru." : "OpenAI tidak bisa dihubungi. Coba lagi sebentar.");
    }
    await saveChatgptSession(c.var.db, session, c.var.actor.id);
    await audit(c.var.db, c.var.actor, { action: "settings.integrations.update", entityId: c.var.actor.id, summary: `Sesi ChatGPT dipasang${session.email ? ` (${session.email})` : ""}` });
    return c.json({ email: session.email });
  })
  .delete("/chatgpt/session", async (c) => {
    await saveChatgptSession(c.var.db, null, c.var.actor.id);
    await audit(c.var.db, c.var.actor, { action: "settings.integrations.update", entityId: c.var.actor.id, summary: "Keluar dari ChatGPT" });
    return c.json({ ok: true });
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
    await telegramCall(token, "setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"] });
    await registerCommands(token);
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
