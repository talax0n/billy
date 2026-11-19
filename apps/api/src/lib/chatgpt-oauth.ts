import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

/**
 * Sign in with ChatGPT, plan usage (developers.openai.com/siwc/token-sharing-open-source): OAuth with
 * PKCE against auth.openai.com, a loopback callback on 127.0.0.1, then Responses API calls at
 * api.openai.com/v1 billed to the user's ChatGPT plan. The first sign-in registers this app
 * (`dynamic_agent_client`) and the callback returns the client id to keep for every later refresh.
 */
export const CHATGPT = {
  authorizeUrl: "https://auth.openai.com/api/accounts/authorize",
  tokenUrl: "https://auth.openai.com/api/accounts/oauth/token",
  resource: "https://api.openai.com/v1",
  scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
  planScope: "chatgpt.tokens.use.direct",
  port: 1455,
  appName: "billy",
} as const;
// "Do not substitute with localhost": only the port may ever change.
export const CHATGPT_REDIRECT = `http://127.0.0.1:${CHATGPT.port}/auth/callback`;

/** A signed-in ChatGPT session: the issued client id and its current tokens. */
export interface ChatgptSession {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  /** Epoch ms when the access token stops working. */
  expiresAt: number;
  email: string | null;
}

/** The session is gone for good (revoked, expired, reused): the user has to sign in again. */
export class ChatgptSignInRequired extends Error {}

const SIGN_IN_AGAIN = new Set(["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"]);
const b64url = (buf: Buffer) => buf.toString("base64url");

/** Fresh per-attempt secrets: PKCE verifier and challenge, state, nonce. */
export function newAttempt() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()), state: b64url(randomBytes(16)), nonce: b64url(randomBytes(16)) };
}
export type SignInAttempt = ReturnType<typeof newAttempt>;

/** A stable `ext_agent_host_id` for one host (this server, or the computer running the sign-in command). */
export const newHostId = () => `urn:uuid:${crypto.randomUUID()}`;

/** The URL to open in the browser. Reauthorization reuses the issued client id and the last id token. */
export function authorizeUrl(attempt: SignInAttempt, hostId: string, previous?: { clientId: string; idToken: string } | null) {
  const params = new URLSearchParams({
    client_id: previous?.clientId ?? "dynamic_agent_client",
    ext_agent_host_id: hostId,
    response_type: "code",
    redirect_uri: CHATGPT_REDIRECT,
    scope: CHATGPT.scope,
    resource: CHATGPT.resource,
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge_method: "S256",
    code_challenge: attempt.challenge,
  });
  if (previous) params.set("id_token_hint", previous.idToken);
  else params.set("agent_name_hint", CHATGPT.appName);
  return `${CHATGPT.authorizeUrl}?${params}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  expires_in: number;
  scope?: string;
}

/** The claims of a JWT we received straight from OpenAI's token endpoint over TLS (not re-verified here). */
function claims(jwt: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function tokenRequest(form: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenResponse> {
  const res = await fetchImpl(CHATGPT.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!res.ok) {
    if (body.error && SIGN_IN_AGAIN.has(body.error)) throw new ChatgptSignInRequired(body.error);
    throw new Error(`ChatGPT token endpoint ${res.status}: ${body.error ?? ""} ${body.error_description ?? ""}`.trim());
  }
  return body as TokenResponse;
}

function toSession(clientId: string, tokens: TokenResponse, previous: ChatgptSession | null, nonce?: string): ChatgptSession {
  const granted = (tokens.scope ?? CHATGPT.scope).split(" ");
  if (!granted.includes(CHATGPT.planScope)) throw new Error("Izin memakai paket ChatGPT tidak diberikan saat masuk");
  const idToken = tokens.id_token ?? previous?.idToken ?? "";
  const idClaims = claims(idToken);
  if (nonce && idClaims.nonce !== nonce) throw new Error("Jawaban masuk ChatGPT tidak cocok dengan permintaan ini (nonce)");
  return {
    clientId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    email: typeof idClaims.email === "string" ? idClaims.email : (previous?.email ?? null),
  };
}

/** Trades the callback's code for a session. The client id is the issued one from the callback. */
export async function exchangeCode(clientId: string, code: string, attempt: SignInAttempt, fetchImpl: typeof fetch = fetch) {
  const tokens = await tokenRequest(
    { grant_type: "authorization_code", client_id: clientId, code, code_verifier: attempt.verifier, redirect_uri: CHATGPT_REDIRECT, resource: CHATGPT.resource },
    fetchImpl,
  );
  return toSession(clientId, tokens, null, attempt.nonce);
}

/** A new access token; the refresh token rotates, so the caller must store the result before anything else refreshes. */
export async function refreshSession(session: ChatgptSession, fetchImpl: typeof fetch = fetch) {
  const tokens = await tokenRequest({ grant_type: "refresh_token", client_id: session.clientId, refresh_token: session.refreshToken, resource: CHATGPT.resource }, fetchImpl);
  return toSession(session.clientId, tokens, session);
}

/**
 * Listens on 127.0.0.1:1455 for one callback of this attempt and returns its code and issued client id.
 * Start it before opening the browser. Rejects on a declined consent or after `timeoutMs`; a request with
 * another attempt's state is refused without ending this one.
 */
export function awaitCallback(attempt: SignInAttempt, { timeoutMs = 5 * 60_000, previousClientId = null as string | null } = {}) {
  return new Promise<{ code: string; clientId: string }>((resolve, reject) => {
    const page = (title: string, text: string) =>
      `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:3rem"><h1>${title}</h1><p>${text}</p></body>`;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", CHATGPT_REDIRECT);
      if (url.pathname !== "/auth/callback") return void res.writeHead(404).end();
      const q = url.searchParams;
      const finish = (ok: boolean, message: string, result?: { code: string; clientId: string }) => {
        res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8" }).end(page(ok ? "Berhasil masuk" : "Gagal masuk", message));
        clearTimeout(timer);
        server.close();
        server.closeAllConnections();
        if (result) resolve(result);
        else reject(new Error(message));
      };
      // A stray or stale request (an old tab) is answered but does not end this attempt.
      if (q.get("state") !== attempt.state) return void res.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(page("Gagal masuk", "Permintaan masuk tidak dikenali. Ulangi dari billy."));
      if (q.get("error")) return finish(false, q.get("error") === "access_denied" ? "Izin ditolak di ChatGPT." : `ChatGPT menolak: ${q.get("error")}`);
      const code = q.get("code");
      const clientId = q.get("client_id") ?? previousClientId;
      if (!code || !clientId) return finish(false, "Pendaftaran aplikasi belum lengkap. Ulangi dari billy.");
      if (previousClientId && clientId !== previousClientId) return finish(false, "ChatGPT mengembalikan aplikasi lain. Ulangi dari billy.");
      finish(true, "Kembali ke billy. Halaman ini boleh ditutup.", { code, clientId });
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Waktu masuk ChatGPT habis"));
    }, timeoutMs);
    server.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    server.listen(CHATGPT.port, "127.0.0.1");
  });
}

const CODE_PREFIX = "billy-chatgpt-v1.";

/** The session as one string to paste into a hosted billy (OpenAI's "sign in locally, move to the server"). */
export const encodeSessionCode = (s: ChatgptSession) => CODE_PREFIX + b64url(Buffer.from(JSON.stringify(s)));

export function decodeSessionCode(code: string): ChatgptSession | null {
  if (!code.startsWith(CODE_PREFIX)) return null;
  try {
    const s = JSON.parse(Buffer.from(code.slice(CODE_PREFIX.length), "base64url").toString("utf8")) as ChatgptSession;
    return typeof s.clientId === "string" && typeof s.refreshToken === "string" && typeof s.accessToken === "string" ? s : null;
  } catch {
    return null;
  }
}
