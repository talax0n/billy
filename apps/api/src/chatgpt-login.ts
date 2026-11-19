/**
 * Signs in with ChatGPT on this computer and prints a session code to paste into a hosted billy
 * (Pengaturan > Koneksi > Tempel kode sesi). OpenAI's callback only reaches 127.0.0.1 of the computer
 * running the browser, so a server cannot do this sign-in itself; this is their "sign in locally, then
 * move the session to the server" path. After pasting, the server owns the session and refreshes it.
 *
 *   pnpm --filter @billy/api chatgpt:login
 */
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { authorizeUrl, awaitCallback, encodeSessionCode, exchangeCode, newAttempt, newHostId } from "./lib/chatgpt-oauth.ts";

// This computer's host id, and the client id ChatGPT issued to it, so a second run reauthorizes.
const dir = join(homedir(), ".config", "billy");
const file = join(dir, "chatgpt-login.json");
type Saved = { hostId: string; clientId?: string; idToken?: string };
let saved: Saved;
try {
  saved = JSON.parse(readFileSync(file, "utf8")) as Saved;
} catch {
  saved = { hostId: newHostId() };
}

const attempt = newAttempt();
const previous = saved.clientId && saved.idToken ? { clientId: saved.clientId, idToken: saved.idToken } : null;
const callback = awaitCallback(attempt, { previousClientId: previous?.clientId ?? null });
const url = authorizeUrl(attempt, saved.hostId, previous);

console.log("\nBuka alamat ini di browser komputer ini lalu masuk dengan akun ChatGPT:\n");
console.log(url, "\n");
const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
execFile(opener, [url], () => undefined);

try {
  const { code, clientId } = await callback;
  const session = await exchangeCode(clientId, code, attempt);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ hostId: saved.hostId, clientId, idToken: session.idToken }), { mode: 0o600 });
  console.log(`Berhasil masuk${session.email ? ` sebagai ${session.email}` : ""}.\n`);
  console.log("Tempel kode sesi ini di billy, Pengaturan, Koneksi, Tempel kode sesi. Kode ini rahasia: siapa pun yang memegangnya bisa memakai paket ChatGPT Anda.\n");
  console.log(encodeSessionCode(session), "\n");
  process.exit(0);
} catch (err) {
  console.error("Gagal masuk:", err instanceof Error ? err.message : err);
  process.exit(1);
}
