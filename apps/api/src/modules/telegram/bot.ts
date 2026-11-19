import { randomInt } from "node:crypto";
import { type Db, telegramChats, telegramLinkCodes, telegramUpdates, users } from "@billy/db";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import type { Actor } from "../../env.ts";
import type { StockAgentImage, StockAgentInput } from "./agent.ts";

/** How the bot reaches the outside: Telegram for replies, Claude for the stock agent. Tests pass fakes. */
export interface BotDeps {
  send: (chatId: string, text: string) => Promise<void>;
  typing: (chatId: string) => Promise<void>;
  agent: (input: StockAgentInput) => Promise<string>;
  /** Fetches a photo or image file the user sent, as base64 for Claude. */
  download: (fileId: string, mediaType: StockAgentImage["mediaType"]) => Promise<StockAgentImage>;
}

const LINK_CODE_MINUTES = 15;
/** Telegram rejects longer messages. */
const MAX_REPLY = 4000;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Claude reads images up to 5 MB; a phone photo sent through Telegram is far smaller. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const imageTypes = ["image/jpeg", "image/png", "image/webp"] as const;

/** The parts of a Telegram update the bot reads; anything else (edits, stickers, channel posts) is ignored. */
export const telegramUpdate = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      chat: z.object({ id: z.number().int() }),
      text: z.string().optional(),
      caption: z.string().optional(),
      /** One entry per size Telegram made of the photo, smallest first. */
      photo: z.array(z.object({ file_id: z.string(), file_size: z.number().optional() })).optional(),
      /** A picture sent "as file" keeps its original quality and arrives as a document. */
      document: z.object({ file_id: z.string(), mime_type: z.string().optional(), file_size: z.number().optional() }).optional(),
    })
    .optional(),
});
export type TelegramUpdate = z.infer<typeof telegramUpdate>;

/** A one-time code the signed-in user sends to the bot as `/start <code>`. */
export async function createLinkCode(db: Db, userId: string) {
  const code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  await db.delete(telegramLinkCodes).where(eq(telegramLinkCodes.userId, userId));
  await db.insert(telegramLinkCodes).values({ code, userId, expiresAt: new Date(Date.now() + LINK_CODE_MINUTES * 60_000) });
  return { code, minutes: LINK_CODE_MINUTES };
}

async function link(db: Db, chatId: string, code: string) {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .delete(telegramLinkCodes)
      .where(and(eq(telegramLinkCodes.code, code.toUpperCase()), gt(telegramLinkCodes.expiresAt, new Date())))
      .returning({ userId: telegramLinkCodes.userId });
    if (!found) return null;
    // One chat per user and one user per chat: a new link replaces both old ones.
    await tx.delete(telegramChats).where(eq(telegramChats.userId, found.userId));
    await tx.delete(telegramChats).where(eq(telegramChats.chatId, chatId));
    await tx.insert(telegramChats).values({ chatId, userId: found.userId });
    const [user] = await tx.select({ name: users.name }).from(users).where(eq(users.id, found.userId));
    return user!.name;
  });
}

const HELP =
  "Bot ini mencatat sisa stok dari laporan SPB ke draf stok opname di billy.\n\nHubungkan dulu: buka billy, Pengaturan, Telegram, lalu kirim kode yang muncul di sana, misalnya: /start ABCD2345";

/**
 * Handles one Telegram update: links a chat with `/start <code>`, otherwise hands a linked admin's or
 * staff's message to the stock agent and sends its reply. An update seen before is skipped, because
 * Telegram resends updates it thinks failed.
 */
export async function handleUpdate(db: Db, update: TelegramUpdate, deps: BotDeps) {
  const [fresh] = await db.insert(telegramUpdates).values({ updateId: update.update_id }).onConflictDoNothing().returning();
  const message = update.message;
  if (!fresh || !message) return;
  const text = (message.text ?? message.caption ?? "").trim();
  const image = imageOf(message);
  if (!text && !image) return;
  const chatId = String(message.chat.id);

  const start = /^\/start(?:@\w+)?(?:\s+(\S+))?$/i.exec(text);
  if (start) {
    const name = start[1] ? await link(db, chatId, start[1]) : null;
    if (start[1] && !name) return deps.send(chatId, "Kode tidak dikenal atau sudah kedaluwarsa. Buat kode baru di billy, Pengaturan, Telegram.");
    return deps.send(chatId, name ? `Terhubung sebagai ${name}. Teruskan laporan SPB ke sini, misalnya:\nDulux weathershield base A galon sisa 6, pentalite base B pail 3` : HELP);
  }

  const [chat] = await db
    .select({ userId: users.id, role: users.role, active: users.active, lastReply: telegramChats.lastReply })
    .from(telegramChats)
    .innerJoin(users, eq(users.id, telegramChats.userId))
    .where(eq(telegramChats.chatId, chatId));
  if (!chat || !chat.active) return deps.send(chatId, HELP);
  if (chat.role === "kasir") return deps.send(chatId, "Akun kasir tidak bisa mencatat stok opname. Minta admin atau staf kantor.");

  if (image && "tooBig" in image) return deps.send(chatId, "Gambarnya terlalu besar (maksimal 5 MB). Kirim sebagai foto biasa, bukan file.");

  const actor: Actor = { id: chat.userId, role: chat.role, source: "telegram" };
  await deps.typing(chatId).catch(() => undefined);
  let reply: string;
  try {
    const images = image ? [await deps.download(image.fileId, image.mediaType)] : [];
    reply = (await deps.agent({ db, actor, text, lastReply: chat.lastReply, images })).slice(0, MAX_REPLY);
  } catch (err) {
    console.error("telegram stock agent failed", err);
    reply = "Maaf, sistem sedang bermasalah dan laporan ini belum tercatat. Coba kirim lagi sebentar lagi.";
  }
  await db.update(telegramChats).set({ lastReply: reply }).where(eq(telegramChats.chatId, chatId));
  await deps.send(chatId, reply);
}

type IncomingMessage = NonNullable<TelegramUpdate["message"]>;

/** The picture in a message, if any: the largest size of a photo, or an image sent as a file. */
function imageOf(message: IncomingMessage): { fileId: string; mediaType: StockAgentImage["mediaType"] } | { tooBig: true } | null {
  const photo = message.photo?.at(-1);
  if (photo) return (photo.file_size ?? 0) > MAX_IMAGE_BYTES ? { tooBig: true } : { fileId: photo.file_id, mediaType: "image/jpeg" };
  const doc = message.document;
  const mediaType = imageTypes.find((t) => t === doc?.mime_type);
  if (!doc || !mediaType) return null;
  return (doc.file_size ?? 0) > MAX_IMAGE_BYTES ? { tooBig: true } : { fileId: doc.file_id, mediaType };
}
