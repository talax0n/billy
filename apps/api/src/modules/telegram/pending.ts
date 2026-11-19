import { randomBytes } from "node:crypto";
import { DomainError } from "@billy/core";
import { categories, type Db, products, telegramChats } from "@billy/db";
import { and, eq, inArray } from "drizzle-orm";
import type { Actor } from "../../env.ts";
import type { ReplyMarkup } from "./bot-format.ts";
import { clearCounts, recordCounts } from "./stock-tools.ts";

/**
 * Nothing the bot changes in the database happens without the user's yes. The agent's write tools only
 * prepare a change here, per chat; billy shows exactly what will be saved, with Simpan and Batal buttons,
 * and only a confirmation writes it, without the AI. Corrections before confirming update the prepared
 * change: a product counted again gets its new number, a new one is added.
 */
export interface PendingWrite {
  /** One-time id on the buttons, so a tap on an older confirmation cannot save this one. */
  nonce: string;
  preparedAt: number;
  categoryId: string;
  brand: string;
  counts: { productId: string; name: string; unit: string; qty: number }[];
  clears: { productId: string; name: string }[];
}

const EXPIRES_MS = 30 * 60_000;

export async function loadPending(db: Db, chatId: string): Promise<PendingWrite | null> {
  const [row] = await db.select({ pending: telegramChats.pendingWrite }).from(telegramChats).where(eq(telegramChats.chatId, chatId));
  const pending = (row?.pending ?? null) as PendingWrite | null;
  return pending && Date.now() - pending.preparedAt < EXPIRES_MS ? pending : null;
}

const save = (db: Db, chatId: string, pending: PendingWrite | null) => db.update(telegramChats).set({ pendingWrite: pending }).where(eq(telegramChats.chatId, chatId));

/** The brand's active products among `ids`, refusing any that are not, so a confirmation never fails on scope. */
async function brandProducts(db: Db, categoryId: string, ids: string[]) {
  const [brand] = await db.select({ name: categories.name }).from(categories).where(eq(categories.id, categoryId));
  if (!brand) throw new DomainError("invalid", "Brand tidak dikenal");
  const rows = await db
    .select({ id: products.id, name: products.name, variant: products.variant, unit: products.unit })
    .from(products)
    .where(and(inArray(products.id, ids), eq(products.categoryId, categoryId), eq(products.active, true)));
  if (rows.length !== new Set(ids).size) throw new DomainError("invalid", `Ada barang yang bukan produk aktif brand ${brand.name}`);
  return { brand: brand.name, byId: new Map(rows.map((r) => [r.id, { name: `${r.name} ${r.variant}`.trim(), unit: r.unit }])) };
}

/** The prepared change for this brand, continued, or a fresh one (a different brand starts over). */
async function base(db: Db, chatId: string, categoryId: string, brand: string): Promise<PendingWrite> {
  const current = await loadPending(db, chatId);
  if (current?.categoryId === categoryId) return { ...current, nonce: randomBytes(6).toString("base64url"), preparedAt: Date.now() };
  return { nonce: randomBytes(6).toString("base64url"), preparedAt: Date.now(), categoryId, brand, counts: [], clears: [] };
}

/** Adds counts to the prepared change; a product counted again gets its new number. Nothing is saved yet. */
export async function prepareCounts(db: Db, chatId: string, categoryId: string, lines: { productId: string; qty: number }[]) {
  const { brand, byId } = await brandProducts(
    db,
    categoryId,
    lines.map((l) => l.productId),
  );
  const pending = await base(db, chatId, categoryId, brand);
  for (const l of lines) {
    const product = byId.get(l.productId)!;
    pending.counts = [...pending.counts.filter((c) => c.productId !== l.productId), { productId: l.productId, name: product.name, unit: product.unit, qty: l.qty }];
    pending.clears = pending.clears.filter((c) => c.productId !== l.productId);
  }
  await save(db, chatId, pending);
  return pending;
}

/** Marks counts for removal; a product only prepared, not yet saved, just leaves the list. Nothing is saved yet. */
export async function prepareClears(db: Db, chatId: string, categoryId: string, productIds: string[]) {
  const { brand, byId } = await brandProducts(db, categoryId, productIds);
  const pending = await base(db, chatId, categoryId, brand);
  for (const id of productIds) {
    const wasPrepared = pending.counts.some((c) => c.productId === id);
    pending.counts = pending.counts.filter((c) => c.productId !== id);
    if (!wasPrepared && !pending.clears.some((c) => c.productId === id)) pending.clears.push({ productId: id, name: byId.get(id)!.name });
  }
  await save(db, chatId, pending.counts.length || pending.clears.length ? pending : null);
  return pending;
}

/** The confirmation billy shows, from the database's own names: never the AI's wording. */
export function confirmation(pending: PendingWrite): { text: string; markup: ReplyMarkup } {
  const lines = [
    `Simpan ke draf opname ${pending.brand}?`,
    ...pending.counts.map((c) => `✓ ${c.name}: ${c.qty}`),
    ...pending.clears.map((c) => `✗ ${c.name}: hapus hitungan`),
  ];
  return {
    text: lines.join("\n"),
    markup: { inline_keyboard: [[{ text: "✅ Simpan", callback_data: `simpan:${pending.nonce}` }, { text: "✖️ Batal", callback_data: `batal:${pending.nonce}` }]] },
  };
}

/** What the user confirmed, as a sentence for the agent's context. */
export const pendingSummary = (pending: PendingWrite | null) =>
  pending ? `${confirmation(pending).text}\n(belum disimpan, menunggu pengguna menekan Simpan)` : "(tidak ada)";

/**
 * Saves the prepared change. `nonce` is the one on the tapped button, or null for a typed "ya": a stale
 * button is refused. Returns the reply to send.
 */
export async function confirmPending(db: Db, chatId: string, actor: Actor, nonce: string | null) {
  const pending = await loadPending(db, chatId);
  if (!pending || (nonce !== null && nonce !== pending.nonce)) return "Tidak ada yang menunggu disimpan, atau konfirmasi ini sudah kedaluwarsa.";
  await save(db, chatId, null);
  let opname = "";
  if (pending.counts.length) opname = (await recordCounts(db, actor, pending.categoryId, pending.counts.map((c) => ({ productId: c.productId, qty: c.qty })))).opname;
  if (pending.clears.length) opname = (await clearCounts(db, actor, pending.categoryId, pending.clears.map((c) => c.productId))).opname;
  return [`Tersimpan di draf ${opname}`, ...pending.counts.map((c) => `✓ ${c.name}: ${c.qty}`), ...pending.clears.map((c) => `✗ ${c.name}: dihapus`)].join("\n");
}

export async function cancelPending(db: Db, chatId: string, nonce: string | null) {
  const pending = await loadPending(db, chatId);
  if (!pending || (nonce !== null && nonce !== pending.nonce)) return "Tidak ada yang menunggu disimpan.";
  await save(db, chatId, null);
  return "Dibatalkan, tidak ada yang disimpan.";
}
