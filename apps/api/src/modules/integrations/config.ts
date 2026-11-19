import { type Db, integrationSettings } from "@billy/db";
import { eq } from "drizzle-orm";
import { type ChatgptSession, ChatgptSignInRequired, newHostId, refreshSession } from "../../lib/chatgpt-oauth.ts";
import { open, seal } from "../../lib/secret-box.ts";

/** How the bot reaches ChatGPT: the admin's ChatGPT sign-in (plan usage), or an OpenAI API key. */
export type AiAuth = { kind: "chatgpt"; email: string | null } | { kind: "api_key"; source: "web" | "env" } | null;

export interface Integrations {
  ai: { model: string; auth: AiAuth };
  telegram: { token: string | null; username: string; webhookSecret: string | null };
}

/** Refresh a little early, so a token never expires in the middle of one bot reply. */
const REFRESH_MARGIN_MS = 2 * 60_000;

export async function storedIntegrations(db: Db) {
  const [row] = await db.select().from(integrationSettings).where(eq(integrationSettings.id, 1));
  return row ?? null;
}

const openSession = (sealed: string | null | undefined) => {
  const raw = open(sealed ?? null);
  return raw ? (JSON.parse(raw) as ChatgptSession) : null;
};

/**
 * The connections in effect: what the admin saved in the web, and for anything not saved there, the
 * environment variables (OPENAI_API_KEY, TELEGRAM_BOT_TOKEN, ...). Read per use, so a change in the web
 * applies to the next message without a restart. A ChatGPT sign-in wins over an API key.
 */
export async function loadIntegrations(db: Db): Promise<Integrations> {
  const row = await storedIntegrations(db);
  const env = process.env;
  const session = openSession(row?.chatgptSession);
  const webKey = open(row?.openaiApiKey ?? null);
  const auth: AiAuth = session ? { kind: "chatgpt", email: session.email } : webKey ? { kind: "api_key", source: "web" } : env.OPENAI_API_KEY ? { kind: "api_key", source: "env" } : null;
  const savedToken = open(row?.telegramBotToken ?? null);
  return {
    ai: { model: row?.aiModel ?? "", auth },
    telegram: {
      token: savedToken ?? env.TELEGRAM_BOT_TOKEN ?? null,
      // A username saved with a token belongs to that token; the env pair goes together too.
      username: (savedToken ? row?.telegramBotUsername : env.TELEGRAM_BOT_USERNAME) ?? "",
      webhookSecret: open(row?.telegramWebhookSecret ?? null) ?? env.TELEGRAM_WEBHOOK_SECRET ?? null,
    },
  };
}

/** Saves (or with null, removes) the ChatGPT session. */
export async function saveChatgptSession(db: Db, session: ChatgptSession | null, updatedBy?: string) {
  const value = session ? seal(JSON.stringify(session)) : null;
  await db
    .insert(integrationSettings)
    .values({ id: 1, chatgptSession: value, ...(updatedBy && { updatedBy }) })
    .onConflictDoUpdate({ target: integrationSettings.id, set: { chatgptSession: value, updatedAt: new Date(), ...(updatedBy && { updatedBy }) } });
}

/** This server's `ext_agent_host_id`, made on first use and kept, as OpenAI asks one stable id per host. */
export async function chatgptHostId(db: Db) {
  const row = await storedIntegrations(db);
  if (row?.chatgptHostId) return row.chatgptHostId;
  const hostId = newHostId();
  await db.insert(integrationSettings).values({ id: 1, chatgptHostId: hostId }).onConflictDoUpdate({ target: integrationSettings.id, set: { chatgptHostId: hostId } });
  return hostId;
}

/**
 * A bearer token for the Responses API: the ChatGPT session's access token, refreshed when near expiry,
 * else the OpenAI API key. Refreshes run one at a time under a row lock, because each refresh replaces
 * the refresh token and a second refresh with the old one would end the session. Only OpenAI's "sign in
 * again" answers clear the session; a network failure leaves it for the next try.
 */
export async function aiBearer(db: Db, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const signInRequired = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(integrationSettings).where(eq(integrationSettings.id, 1)).for("update");
    const session = openSession(row?.chatgptSession);
    if (!session) return { token: open(row?.openaiApiKey ?? null) ?? process.env.OPENAI_API_KEY ?? null };
    if (session.expiresAt - REFRESH_MARGIN_MS > Date.now()) return { token: session.accessToken };
    try {
      const fresh = await refreshSession(session, fetchImpl);
      await tx.update(integrationSettings).set({ chatgptSession: seal(JSON.stringify(fresh)) }).where(eq(integrationSettings.id, 1));
      return { token: fresh.accessToken };
    } catch (err) {
      if (err instanceof ChatgptSignInRequired) return { expired: true as const };
      throw err;
    }
  });
  if ("token" in signInRequired) return signInRequired.token;
  await saveChatgptSession(db, null);
  throw new ChatgptSignInRequired("Sesi ChatGPT berakhir. Admin perlu masuk lagi dengan ChatGPT di billy, Pengaturan, Koneksi.");
}
