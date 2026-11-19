import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { DomainError } from "@billy/core";

/**
 * Encrypts secrets the admin types in the web (AI keys, bot token) before they reach the database, with
 * AES-256-GCM under BILLY_SECRET_KEY. A database copy (backup, local pull) is then useless without the
 * server's key. Changing BILLY_SECRET_KEY makes stored secrets unreadable; they must be entered again.
 */
const VERSION = "v1";

function key() {
  const secret = process.env.BILLY_SECRET_KEY;
  if (!secret) throw new DomainError("invalid", "BILLY_SECRET_KEY belum diatur di server, jadi kunci rahasia tidak bisa disimpan");
  return createHash("sha256").update(secret).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

/** The plain secret, or null when there is none or it no longer opens under the current key. */
export function open(sealed: string | null): string | null {
  if (!sealed?.startsWith(`${VERSION}:`)) return null;
  try {
    const raw = Buffer.from(sealed.slice(VERSION.length + 1), "base64");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** What the web may show of a secret: that it exists and its last four characters. */
export const hint = (plain: string | null) => (plain ? `…${plain.slice(-4)}` : null);
