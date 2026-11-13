/**
 * Shared HTTP session for the read-only legacy E-Jurnal export.
 * The `ci_session` cookie comes from a curl cookie jar (LEGACY_JAR); credentials never touch this code.
 */
import { readFileSync } from "node:fs";

export const BASE = "https://acitech.web.id/e-jurnal";
export const OUT = new URL("../../.legacy/", import.meta.url).pathname;

const jar = process.env.LEGACY_JAR;
if (!jar) throw new Error("Set LEGACY_JAR to a curl cookie jar holding a logged-in ci_session");
const cookie = readFileSync(jar, "utf8")
  .split("\n")
  .filter((line) => line.includes("ci_session"))
  .map((line) => `ci_session=${line.trim().split("\t").at(-1)}`)[0];
if (!cookie) throw new Error("No ci_session in the cookie jar");

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET or form POST with retries; throws if the session has expired (login page served). */
export async function request(path: string, form?: Record<string, string>): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${BASE}/${path}`, {
        method: form ? "POST" : "GET",
        headers: { cookie, "x-requested-with": "XMLHttpRequest", ...(form && { "content-type": "application/x-www-form-urlencoded" }) },
        ...(form && { body: new URLSearchParams(form).toString() }),
        signal: AbortSignal.timeout(60_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status} ${path}`);
      if (text.includes("cek_login")) throw new Error("SESSION_EXPIRED");
      return text;
    } catch (error) {
      if ((error as Error).message === "SESSION_EXPIRED" || attempt >= 5) throw error;
      await sleep(2000 * attempt);
    }
  }
}
