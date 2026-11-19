import { type BusinessDate, formatDate, formatRupiah, type Role, rupiah } from "@billy/core";
import type { dailySummary, deliveriesToday, receivables } from "./query-tools.ts";

/** Telegram's reply markup: a menu kept under the input box, or buttons under one message. */
export type ReplyMarkup =
  | { keyboard: { text: string }[][]; resize_keyboard: true; is_persistent: true }
  | { inline_keyboard: { text: string; callback_data: string }[][] };

/** The menu buttons. Each sends its label as a message; the bot answers the ones it knows without the AI. */
export const MENU = {
  stock: "📦 Cek stok",
  receivables: "🧾 Piutang",
  deliveries: "🚚 Antaran",
  summary: "📊 Ringkasan",
  help: "❓ Bantuan",
} as const;
export type MenuAction = keyof typeof MENU;

export function menuKeyboard(role: Role): ReplyMarkup {
  return {
    keyboard: [
      [{ text: MENU.stock }, { text: MENU.receivables }],
      role === "admin" ? [{ text: MENU.deliveries }, { text: MENU.summary }] : [{ text: MENU.deliveries }],
      [{ text: MENU.help }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

export const menuAction = (text: string) => (Object.entries(MENU).find(([, label]) => label === text)?.[0] as MenuAction | undefined) ?? null;

export const HELP = `Lapor sisa stok dari SPB, misalnya:
Dulux weathershield base A galon 6, pentalite B pail 3

Atau kirim foto catatan SPB.

Tanya juga bisa:
sisa catylac ext base A galon
riwayat stok vinilex 5000 pail
piutang toko bangun jaya`;

export const STOCK_PROMPT = "Ketik nama barangnya, misalnya: catylac ext base A galon";

const rp = (n: number) => formatRupiah(rupiah(n));

const deliveryOrder = ["menunggu", "di jalan", "sampai", "batal"] as const;
const deliveryIcon: Record<(typeof deliveryOrder)[number], string> = { menunggu: "⏳", "di jalan": "🚚", sampai: "✅", batal: "✖️" };

export function formatDeliveries(rows: Awaited<ReturnType<typeof deliveriesToday>>) {
  if (rows.length === 0) return "Tidak ada antaran hari ini.";
  const groups = deliveryOrder.flatMap((status) => {
    const inGroup = rows.filter((r) => r.status === status);
    if (inGroup.length === 0) return [];
    const lines = inGroup.map((r) => `• ${[r.pelanggan, r.alamat, r.sopir, r.alasan_batal].filter(Boolean).join(" · ")}`);
    return [`${deliveryIcon[status]} ${status[0]!.toUpperCase()}${status.slice(1)} (${inGroup.length})`, ...lines];
  });
  return groups.join("\n");
}

export function formatReceivables(r: Awaited<ReturnType<typeof receivables>>) {
  if (r.jumlah_pelanggan === 0) return "Tidak ada piutang.";
  const lines = r.pelanggan.map((c, i) => `${i + 1}. ${c.pelanggan} ${rp(c.total)}${"jumlah_faktur" in c ? ` · ${c.jumlah_faktur} faktur` : ""}`);
  return [`Piutang ${rp(r.total_piutang)} · ${r.jumlah_pelanggan} pelanggan`, ...lines].join("\n");
}

export function formatSummary(s: Awaited<ReturnType<typeof dailySummary>>) {
  return [
    formatDate(s.tanggal as BusinessDate),
    `Penjualan ${rp(s.penjualan)} (kasir ${rp(s.penjualan_kasir)}, faktur ${rp(s.penjualan_faktur)})`,
    `Laba kotor ${rp(s.laba_kotor)}`,
    `Kas masuk ${rp(s.kas_masuk)} · keluar ${rp(s.kas_keluar)}`,
    `Piutang ${rp(s.piutang)} · lewat tempo ${rp(s.piutang_lewat_tempo)}`,
    `Hutang jatuh tempo ${rp(s.hutang_jatuh_tempo)}`,
    "",
    ...s.saldo.map((a) => `${a.akun} ${rp(a.saldo)}`),
    `Total saldo ${rp(s.total_saldo)}`,
  ].join("\n");
}

/** Strips markdown the model may still add (Telegram shows it as raw characters) and extra blank lines. */
export function cleanReply(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#+[ \t]*/gm, "")
    .replace(/^[ \t]*[-*][ \t]+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const OPTION = /^\s*(\d{1,2})[.)]\s+(.+)$/;

/**
 * When a reply asks the user to pick from numbered options (1. …, 2. …), one button per option, so a tap
 * answers instead of typing the number. Only a run that starts at 1 and counts up is taken as options.
 */
export function optionButtons(reply: string): ReplyMarkup | null {
  const options = reply.split("\n").flatMap((line) => {
    const m = OPTION.exec(line);
    return m ? [{ n: Number(m[1]), label: m[2]!.trim() }] : [];
  });
  if (options.length < 2 || options.some((o, i) => o.n !== i + 1) || options.length > 8) return null;
  return {
    inline_keyboard: options.map((o) => [{ text: `${o.n}. ${o.label.length > 48 ? `${o.label.slice(0, 47)}…` : o.label}`, callback_data: `pilih:${o.n}` }]),
  };
}
