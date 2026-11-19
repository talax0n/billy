import { auditEvents, integrationSettings } from "@billy/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestApp } from "../../testing.ts";
import { loadIntegrations } from "./config.ts";

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
const telegramAnswers = (result: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true, result })));

describe("connections set in the web", () => {
  it("is for the admin only", async () => {
    expect((await call("/api/integrations", { cookie: staff })).status).toBe(403);
  });

  it("refuses to store a key while the server has no encryption key", async () => {
    vi.stubEnv("BILLY_SECRET_KEY", "");
    const res = await put({ aiProvider: "anthropic", aiModel: "", anthropicApiKey: "sk-ant-uji-1234" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toContain("BILLY_SECRET_KEY");
  });

  it("stores keys encrypted, shows only their last four characters, and keeps or clears them", async () => {
    vi.stubEnv("BILLY_SECRET_KEY", "kunci-uji");
    expect((await put({ aiProvider: "openai", aiModel: "gpt-uji", anthropicApiKey: "sk-ant-uji-1234", openaiApiKey: "sk-openai-uji-9876" })).status).toBe(200);

    const [row] = await db.select().from(integrationSettings).where(eq(integrationSettings.id, 1));
    expect(row!.openaiApiKey).toMatch(/^v1:/);
    expect(JSON.stringify(row)).not.toContain("9876");
    expect(await get()).toMatchObject({
      aiProvider: "openai",
      aiModel: "gpt-uji",
      keys: { anthropic: { hint: "…1234", source: "web" }, openai: { hint: "…9876", source: "web" } },
      canStoreSecrets: true,
    });
    expect((await loadIntegrations(db)).ai).toMatchObject({ provider: "openai", model: "gpt-uji", apiKey: "sk-openai-uji-9876" });

    // Leaving a key out keeps it; null removes it.
    await put({ aiProvider: "anthropic", aiModel: "", anthropicApiKey: null });
    expect((await get()).keys).toEqual({ anthropic: { hint: null, source: null }, openai: { hint: "…9876", source: "web" } });

    const logged = await db.select({ after: auditEvents.after }).from(auditEvents).where(eq(auditEvents.action, "settings.integrations.update"));
    expect(JSON.stringify(logged)).not.toMatch(/1234|9876/);
    expect(logged.at(-1)!.after).toMatchObject({ anthropicApiKey: "dihapus" });
  });

  it("falls back to environment variables for anything not saved in the web", async () => {
    vi.stubEnv("BILLY_SECRET_KEY", "kunci-uji");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-dari-env-5555");
    expect((await loadIntegrations(db)).ai).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5", apiKey: "sk-ant-dari-env-5555" });
    expect((await get()).keys.anthropic).toEqual({ hint: "…5555", source: "env" });
  });

  it("checks a bot token with Telegram and keeps the bot's username", async () => {
    vi.stubEnv("BILLY_SECRET_KEY", "kunci-uji");
    const fetch = telegramAnswers({ username: "TokoUjiBot" });
    const res = await put({ aiProvider: "anthropic", aiModel: "", telegramBotToken: "123456789:AAH-uji-token-bot-telegram-panjang" });
    expect(await res.json()).toEqual({ ok: true, telegramBotUsername: "TokoUjiBot" });
    expect(String(fetch.mock.calls[0]![0])).toContain("/getMe");
    expect((await get()).telegram).toEqual({ token: { hint: "…jang", source: "web" }, username: "TokoUjiBot" });

    fetch.mockResolvedValue(new Response(JSON.stringify({ ok: false, description: "Unauthorized" })));
    expect((await put({ aiProvider: "anthropic", aiModel: "", telegramBotToken: "987654321:AAH-token-yang-salah-sekali-x" })).status).toBe(422);
  });

  it("points Telegram at the webhook with a fresh secret, https only", async () => {
    vi.stubEnv("BILLY_SECRET_KEY", "kunci-uji");
    const fetch = telegramAnswers(true);
    const webhook = (url: string) => call("/api/integrations/telegram/webhook", { method: "PUT", cookie: admin, body: { url } });
    expect((await webhook("http://localhost:8787/api/telegram/webhook")).status).toBe(422);
    expect((await webhook("https://billy.example.com/api/telegram/webhook")).status).toBe(200);
    const body = JSON.parse(String(fetch.mock.calls.at(-1)![1]!.body)) as { url: string; secret_token: string };
    expect(body.url).toBe("https://billy.example.com/api/telegram/webhook");
    expect((await loadIntegrations(db)).telegram.webhookSecret).toBe(body.secret_token);
  });
});
