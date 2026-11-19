import { randomInt } from "node:crypto";
import { type Db, telegramChats, telegramLinkCodes, telegramUpdates, users } from "@billy/db";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import type { Actor } from "../../env.ts";
import type { StockAgentImage, StockAgentInput } from "./agent.ts";
import { cleanReply, formatDeliveries, formatReceivables, formatSummary, HELP, menuAction, menuKeyboard, optionButtons, type ReplyMarkup, STOCK_PROMPT } from "./bot-format.ts";
import { cancelPending, confirmation, confirmPending, loadPending } from "./pending.ts";
import { dailySummary, deliveriesToday, receivables } from "./query-tools.ts";

/** How the bot reaches the outside: Telegram for replies, ChatGPT for the stock agent. Tests pass fakes. */
export interface BotDeps {
  send: (chatId: string, text: string, markup?: ReplyMarkup) => Promise<void>;
  /** Stops the spinner on a tapped button. */
  answerCallback: (callbackId: string) => Promise<void>;
  /** Removes the buttons from a message once they were used, so a second tap cannot repeat it. */
  clearButtons: (chatId: string, messageId: number) => Promise<void>;
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
  /** A tap on a button under a message; `data` is `pilih:<n>` for a numbered option. */
  callback_query: z
    .object({ id: z.string(), data: z.string().optional(), message: z.object({ message_id: z.number().int(), chat: z.object({ id: z.number().int() }) }).optional() })
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
    const [user] = await tx.select({ name: users.name, role: users.role }).from(users).where(eq(users.id, found.userId));
    return user!;
  });
}

const NOT_LINKED = "Hubungkan dulu: buka billy, menu Bot Telegram, lalu kirim kode yang muncul di sana, misalnya /start ABCD2345";

/** What one update asks: its chat, its text (a tapped option becomes its number), an image, a tapped button's id. */
function readUpdate(update: TelegramUpdate) {
  const tap = update.callback_query;
  if (tap?.message) {
    const option = /^pilih:(\d+)$/.exec(tap.data ?? "");
    const decision = /^(simpan|batal):(\S+)$/.exec(tap.data ?? "");
    return {
      chatId: String(tap.message.chat.id),
      text: option ? option[1]! : "",
      image: null,
      callbackId: tap.id,
      tappedMessage: tap.message.message_id,
      decision: decision ? { save: decision[1] === "simpan", nonce: decision[2]! } : null,
    };
  }
  const message = update.message;
  if (!message) return null;
  return { chatId: String(message.chat.id), text: (message.text ?? message.caption ?? "").trim(), image: imageOf(message), callbackId: null, tappedMessage: null, decision: null };
}

const TYPED_YES = /^(ya|iya|y|ok|oke|okay|simpan|benar|betul|sudah benar)[.!]?$/i;
const TYPED_NO = /^(batal|tidak|enggak|nggak|gak|ga|no)[.!]?$/i;

/**
 * Handles one Telegram update: links a chat with `/start <code>`, answers the menu buttons straight from
 * billy, and hands anything else from a linked admin or staff to the stock agent. A reply that offers
 * numbered options gets one button per option. An update seen before is skipped, because Telegram
 * resends updates it thinks failed.
 */
export async function handleUpdate(db: Db, update: TelegramUpdate, deps: BotDeps) {
  const [fresh] = await db.insert(telegramUpdates).values({ updateId: update.update_id }).onConflictDoNothing().returning();
  const incoming = fresh ? readUpdate(update) : null;
  if (!incoming) return;
  const { chatId, text, image, callbackId, tappedMessage, decision } = incoming;
  if (callbackId) await deps.answerCallback(callbackId).catch(() => undefined);
  if (!text && !image && !decision) return;

  const start = /^\/start(?:@\w+)?\s+(\S+)$/i.exec(text);
  if (start) {
    const user = await link(db, chatId, start[1]!);
    if (!user) return deps.send(chatId, "Kode tidak dikenal atau sudah kedaluwarsa. Buat kode baru di billy, menu Bot Telegram.");
    return deps.send(chatId, `Terhubung sebagai ${user.name}.\n\n${HELP}`, menuKeyboard(user.role));
  }

  const [chat] = await db
    .select({ userId: users.id, role: users.role, active: users.active, lastReply: telegramChats.lastReply })
    .from(telegramChats)
    .innerJoin(users, eq(users.id, telegramChats.userId))
    .where(eq(telegramChats.chatId, chatId));
  if (!chat || !chat.active) return deps.send(chatId, NOT_LINKED);
  if (chat.role === "kasir") return deps.send(chatId, "Akun kasir tidak bisa memakai bot ini.");

  const respond = async (reply: string, markup?: ReplyMarkup) => {
    await db.update(telegramChats).set({ lastReply: reply }).where(eq(telegramChats.chatId, chatId));
    await deps.send(chatId, reply.slice(0, MAX_REPLY), markup ?? optionButtons(reply) ?? undefined);
  };

  const actor: Actor = { id: chat.userId, role: chat.role, source: "telegram" };

  // Simpan / Batal on a prepared change, tapped or typed. Only this writes the bot's changes.
  const pending = await loadPending(db, chatId);
  const typed = pending && !decision ? (TYPED_YES.test(text) ? true : TYPED_NO.test(text) ? false : null) : null;
  if (decision || typed !== null) {
    if (tappedMessage !== null) await deps.clearButtons(chatId, tappedMessage).catch(() => undefined);
    const save = decision ? decision.save : typed!;
    const nonce = decision?.nonce ?? null;
    return respond(save ? await confirmPending(db, chatId, actor, nonce) : await cancelPending(db, chatId, nonce));
  }

  // `/start` without a code and `/menu` bring the menu back for a linked chat.
  switch (/^\/(start|menu)(@\w+)?$/i.test(text) ? "help" : menuAction(text)) {
    case "help":
      return respond(HELP, menuKeyboard(chat.role));
    case "stock":
      return respond(STOCK_PROMPT);
    case "receivables":
      return respond(formatReceivables(await receivables(db)));
    case "deliveries":
      return respond(formatDeliveries(await deliveriesToday(db)));
    case "summary":
      return respond(chat.role === "admin" ? formatSummary(await dailySummary(db, chat.role)) : "Ringkasan hanya untuk admin.");
    case null:
      break;
  }

  if (image && "tooBig" in image) return deps.send(chatId, "Gambar terlalu besar (maks 5 MB). Kirim sebagai foto biasa.");

  await deps.typing(chatId).catch(() => undefined);
  let reply: string;
  try {
    const images = image ? [await deps.download(image.fileId, image.mediaType)] : [];
    reply = cleanReply(await deps.agent({ db, actor, chatId, text, lastReply: chat.lastReply, images }));
  } catch (err) {
    console.error("telegram stock agent failed", err);
    reply = "Sistem sedang bermasalah, laporan ini belum tercatat. Coba kirim lagi sebentar lagi.";
  }

  // When the agent prepared a change, billy shows it for confirmation in its own words, after any
  // question the agent still has.
  const prepared = await loadPending(db, chatId);
  if (prepared && prepared.nonce !== pending?.nonce) {
    if (reply) await deps.send(chatId, reply.slice(0, MAX_REPLY), optionButtons(reply) ?? undefined);
    const { text: ask, markup } = confirmation(prepared);
    await db.update(telegramChats).set({ lastReply: reply ? `${reply}\n\n${ask}` : ask }).where(eq(telegramChats.chatId, chatId));
    return deps.send(chatId, ask, markup);
  }
  await respond(reply || "Maaf, saya belum bisa memproses pesan itu. Coba tulis ulang.");
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
