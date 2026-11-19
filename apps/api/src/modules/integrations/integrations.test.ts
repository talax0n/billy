import { auditEvents, integrationSettings } from "@billy/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type ChatgptSession, ChatgptSignInRequired, encodeSessionCode } from "../../lib/chatgpt-oauth.ts";
import { createTestApp } from "../../testing.ts";
import { aiBearer, loadIntegrations, saveChatgptSession } from "./config.ts";

const { call, signIn, db } = await createTestApp();
let admin: string;
let staff: string;

beforeAll(async () => {
  ({ cookie: admin } = await signIn("admin"));
  ({ cookie: staff } = await signIn("staff"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const get = async () => (await (await call("/api/integrations", { cookie: admin })).json()) as Record<string, any>;
const put = (body: object) => call("/api/integrations", { method: "PUT", cookie: admin, body });
const answers = (...bodies: object[]) => {
  const spy = vi.spyOn(globalThis, "fetch");
  for (const body of bodies) spy.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: "error" in body ? 400 : 200 }));
  return spy;
};
const session = (over: Partial<ChatgptSession> = {}): ChatgptSession => ({
  clientId: "issued-1",
  accessToken: "akses-1",
  refreshToken: "segar-1",
  idToken: "x.e30.sig",
  expiresAt: Date.now() + 3600_000,
  email: "pemilik@toko.id",
  ...over,
});
const formOf = (spy: ReturnType<typeof answers>, i: number) => Object.fromEntries(new URLSearchParams(String(spy.mock.calls[i]![1]!.body)));

describe("connections set in the web", () => {
  it("is for the admin only", async () => {
    expect((await call("/api/integrations", { cookie: staff })).status).toBe(403);
  });

  it("refuses to store a key while the server has no encryption key", async () => {
    vi.stubEnv("BILLY_SECRET_KEY", "");
    const res = await put({ aiModel: "", openaiApiKey: "sk-uji-1234" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toContain("BILLY_SECRET_KEY");
  });

  it("stores an OpenAI key encrypted, shows only its last four characters, and keeps or clears it", async () => {
    vi.stubEnv("BILLY_SECRET_KEY", "kunci-uji");
    expect((await put({ aiModel: "model-uji", openaiApiKey: "sk-openai-uji-9876" })).status).toBe(200);
    const [row] = await db.select().from(integrationSettings).where(eq(integrationSettings.id, 1));
    expect(JSON.stringify(row)).not.toContain("9876");
    expect(await get()).toMatchObject({ aiModel: "model-uji", aiAuth: { kind: "api_key", source: "web" }, openaiKey: { hint: "…9876", source: "web" }, chatgpt: null });
    expect(await aiBearer(db)).toBe("sk-openai-uji-9876");

    await put({ aiModel: "model-uji" });
    expect((await get()).openaiKey.hint).toBe("…9876");
    await put({ aiModel: "model-uji", openaiApiKey: null });
    expect((await get()).aiAuth).toBeNull();
    const logged = await db.select({ after: auditEvents.after }).from(auditEvents).where(eq(auditEvents.action, "settings.integrations.update"));
    expect(JSON.stringify(logged)).not.toContain("9876");
  });

  it("takes a ChatGPT session code from another computer, refreshing it once so this server owns it", async () => {
    vi.stubEnv("BILLY_SECRET_KEY", "kunci-uji");
    const fetch = answers({ access_token: "akses-server", refresh_token: "segar-server", expires_in: 3600 });
    const res = await call("/api/integrations/chatgpt/session", { method: "POST", cookie: admin, body: { code: encodeSessionCode(session()) } });
    expect(await res.json()).toEqual({ email: "pemilik@toko.id" });
    expect(formOf(fetch, 0)).toMatchObject({ grant_type: "refresh_token", client_id: "issued-1", refresh_token: "segar-1" });
    expect(await get()).toMatchObject({ aiAuth: { kind: "chatgpt", email: "pemilik@toko.id" }, chatgpt: { email: "pemilik@toko.id" } });
    expect(await aiBearer(db)).toBe("akses-server");

    expect((await call("/api/integrations/chatgpt/session", { method: "POST", cookie: admin, body: { code: "sk-ini-bukan-kode-sesi-chatgpt" } })).status).toBe(422);
    answers({ error: "refresh_token_reused" });
    expect((await call("/api/integrations/chatgpt/session", { method: "POST", cookie: admin, body: { code: encodeSessionCode(session()) } })).status).toBe(422);
  });

  it("refreshes an expiring session, keeps the rotated token, and asks to sign in again only when OpenAI says so", async () => {
    vi.stubEnv("BILLY_SECRET_KEY", "kunci-uji");
    await saveChatgptSession(db, session({ expiresAt: Date.now() + 30_000, refreshToken: "segar-lama" }));
    const fetch = answers({ access_token: "akses-baru", refresh_token: "segar-baru", expires_in: 3600 });
    expect(await aiBearer(db)).toBe("akses-baru");
    expect(await aiBearer(db)).toBe("akses-baru");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(formOf(fetch, 0).refresh_token).toBe("segar-lama");

    await saveChatgptSession(db, session({ expiresAt: 0 }));
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(aiBearer(db)).rejects.toThrow("fetch failed");
    expect((await loadIntegrations(db)).ai.auth).toMatchObject({ kind: "chatgpt" });

    answers({ error: "invalid_grant" });
    await expect(aiBearer(db)).rejects.toBeInstanceOf(ChatgptSignInRequired);
    expect((await loadIntegrations(db)).ai.auth).toBeNull();
  });

  it("signs out of ChatGPT", async () => {
    vi.stubEnv("BILLY_SECRET_KEY", "kunci-uji");
    await saveChatgptSession(db, session());
    expect((await call("/api/integrations/chatgpt/session", { method: "DELETE", cookie: admin })).status).toBe(200);
    expect((await get()).chatgpt).toBeNull();
  });

  it("checks a bot token with Telegram and keeps the bot's username", async () => {
    vi.stubEnv("BILLY_SECRET_KEY", "kunci-uji");
    const fetch = answers({ ok: true, result: { username: "TokoUjiBot" } });
    const res = await put({ aiModel: "", telegramBotToken: "123456789:AAH-uji-token-bot-telegram-panjang" });
    expect(await res.json()).toEqual({ ok: true, telegramBotUsername: "TokoUjiBot" });
    expect(String(fetch.mock.calls[0]![0])).toContain("/getMe");
    expect((await get()).telegram).toEqual({ token: { hint: "…jang", source: "web" }, username: "TokoUjiBot" });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: false, description: "Unauthorized" })));
    expect((await put({ aiModel: "", telegramBotToken: "987654321:AAH-token-yang-salah-sekali-x" })).status).toBe(422);
  });

  it("points Telegram at the webhook with a fresh secret, https only", async () => {
    vi.stubEnv("BILLY_SECRET_KEY", "kunci-uji");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true, result: true })));
    const webhook = (url: string) => call("/api/integrations/telegram/webhook", { method: "PUT", cookie: admin, body: { url } });
    expect((await webhook("http://localhost:8787/api/telegram/webhook")).status).toBe(422);
    expect((await webhook("https://billy.example.com/api/telegram/webhook")).status).toBe(200);
    const body = JSON.parse(String(fetch.mock.calls.at(-1)![1]!.body)) as { url: string; secret_token: string };
    expect(body.url).toBe("https://billy.example.com/api/telegram/webhook");
    expect((await loadIntegrations(db)).telegram.webhookSecret).toBe(body.secret_token);
  });
});
