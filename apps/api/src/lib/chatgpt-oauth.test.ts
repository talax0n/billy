import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  authorizeUrl,
  awaitCallback,
  CHATGPT_REDIRECT,
  ChatgptSignInRequired,
  decodeSessionCode,
  encodeSessionCode,
  exchangeCode,
  newAttempt,
  refreshSession,
} from "./chatgpt-oauth.ts";

const jwt = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const tokenServer = (body: object, status = 200) => vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
const formOf = (call: Parameters<typeof fetch>) => Object.fromEntries(new URLSearchParams(String(call[1]!.body)));

describe("Sign in with ChatGPT", () => {
  it("asks to register billy on first sign-in, and reauthorizes with the issued client id after", () => {
    const attempt = newAttempt();
    expect(attempt.challenge).toBe(createHash("sha256").update(attempt.verifier).digest("base64url"));
    const first = new URL(authorizeUrl(attempt, "urn:uuid:host-1"));
    expect(first.origin + first.pathname).toBe("https://auth.openai.com/api/accounts/authorize");
    expect(Object.fromEntries(first.searchParams)).toEqual({
      client_id: "dynamic_agent_client",
      agent_name_hint: "billy",
      ext_agent_host_id: "urn:uuid:host-1",
      response_type: "code",
      redirect_uri: "http://127.0.0.1:1455/auth/callback",
      scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
      resource: "https://api.openai.com/v1",
      state: attempt.state,
      nonce: attempt.nonce,
      code_challenge_method: "S256",
      code_challenge: attempt.challenge,
    });
    const again = new URL(authorizeUrl(attempt, "urn:uuid:host-1", { clientId: "issued-1", idToken: "id-1" })).searchParams;
    expect([again.get("client_id"), again.get("id_token_hint"), again.has("agent_name_hint")]).toEqual(["issued-1", "id-1", false]);
  });

  it("trades the code for a session, checking the nonce and the plan permission", async () => {
    const attempt = newAttempt();
    const grant = { access_token: "akses-1", refresh_token: "segar-1", expires_in: 3600, scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct" };
    const fetch = tokenServer({ ...grant, id_token: jwt({ nonce: attempt.nonce, email: "pemilik@toko.id" }) });
    const session = await exchangeCode("issued-1", "kode-1", attempt, fetch);
    expect(session).toMatchObject({ clientId: "issued-1", accessToken: "akses-1", refreshToken: "segar-1", email: "pemilik@toko.id" });
    expect(session.expiresAt).toBeGreaterThan(Date.now() + 3500_000);
    expect(String(fetch.mock.calls[0]![0])).toBe("https://auth.openai.com/api/accounts/oauth/token");
    expect(formOf(fetch.mock.calls[0]!)).toEqual({
      grant_type: "authorization_code",
      client_id: "issued-1",
      code: "kode-1",
      code_verifier: attempt.verifier,
      redirect_uri: CHATGPT_REDIRECT,
      resource: "https://api.openai.com/v1",
    });

    await expect(exchangeCode("issued-1", "kode-1", attempt, tokenServer({ ...grant, id_token: jwt({ nonce: "lain" }) }))).rejects.toThrow("nonce");
    await expect(exchangeCode("issued-1", "kode-1", attempt, tokenServer({ ...grant, scope: "openid profile email", id_token: jwt({ nonce: attempt.nonce }) }))).rejects.toThrow("Izin memakai paket ChatGPT");
  });

  it("refreshes with the issued client id, keeps the rotated refresh token, and knows when to give up", async () => {
    const session = { clientId: "issued-1", accessToken: "a", refreshToken: "lama", idToken: jwt({ email: "pemilik@toko.id" }), expiresAt: 0, email: "pemilik@toko.id" };
    const fetch = tokenServer({ access_token: "a2", refresh_token: "baru", expires_in: 3600 });
    expect(await refreshSession(session, fetch)).toMatchObject({ accessToken: "a2", refreshToken: "baru", idToken: session.idToken, email: "pemilik@toko.id" });
    expect(formOf(fetch.mock.calls[0]!)).toEqual({ grant_type: "refresh_token", client_id: "issued-1", refresh_token: "lama", resource: "https://api.openai.com/v1" });

    await expect(refreshSession(session, tokenServer({ error: "refresh_token_reused" }, 400))).rejects.toBeInstanceOf(ChatgptSignInRequired);
    const outage = refreshSession(session, tokenServer({ error: "server_error" }, 503));
    await expect(outage).rejects.toThrow("503");
    await expect(outage).rejects.not.toBeInstanceOf(ChatgptSignInRequired);
  });

  it("receives the callback on 127.0.0.1, refusing a stray request without ending the sign-in", async () => {
    const attempt = newAttempt();
    const callback = awaitCallback(attempt, { timeoutMs: 4000 });
    await new Promise((r) => setTimeout(r, 50));
    expect((await fetch("http://127.0.0.1:1455/auth/callback?state=tab-lama&code=x&client_id=y")).status).toBe(400);
    const done = await fetch(`http://127.0.0.1:1455/auth/callback?state=${attempt.state}&code=kode-2&client_id=issued-2&scope=openid`);
    expect(done.status).toBe(200);
    expect(await callback).toEqual({ code: "kode-2", clientId: "issued-2" });

    const declined = newAttempt();
    const refused = awaitCallback(declined, { timeoutMs: 4000 });
    const settled = refused.catch((err: Error) => err.message);
    await new Promise((r) => setTimeout(r, 50));
    await fetch(`http://127.0.0.1:1455/auth/callback?state=${declined.state}&error=access_denied`);
    expect(await settled).toBe("Izin ditolak di ChatGPT.");
  });

  it("round-trips a session as a code to paste, and rejects anything else", () => {
    const session = { clientId: "c", accessToken: "a", refreshToken: "r", idToken: "i", expiresAt: 1, email: null };
    expect(decodeSessionCode(encodeSessionCode(session))).toEqual(session);
    expect(decodeSessionCode("sk-bukan-kode-sesi")).toBeNull();
  });
});
