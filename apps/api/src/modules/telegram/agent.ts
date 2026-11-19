import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { DomainError } from "@billy/core";
import type { Db } from "@billy/db";
import { z } from "zod";
import type { Actor } from "../../env.ts";
import { dailySummary, deliveriesToday, receivables, stockHistory, stockLookup } from "./query-tools.ts";
import { brandList, clearCounts, draftsSummary, findProducts, recordCounts } from "./stock-tools.ts";

export const STOCK_AGENT_MODEL = "claude-opus-5-5";

/** Stable across requests (no dates, no data), so it caches; everything that changes goes in the user message. */
const SYSTEM = `Kamu asisten toko cat di Telegram untuk admin dan staf kantor. Ada dua jenis pekerjaan.

A. Mencatat laporan SPB (petugas dari pabrik cat) tentang sisa stok fisik di rak, sebagai hitungan di draf stok opname brand itu. Admin memeriksa dan memposting draf di aplikasi billy; kamu tidak pernah mengubah stok langsung.
1. Tentukan brand dari pesan dan daftar brand di konteks. Kalau brandnya tidak jelas, tanyakan.
2. Untuk setiap barang yang disebut, panggil cari_barang dengan kata-kata staf (nama, base, warna, ukuran). Ukuran: 2,5 L / 5 KG / galon = GALON; 20 L / 25 KG / pail = PAIL; 1 L / 1 KG = LITER.
3. Catat dengan catat_hitungan hanya barang yang cocoknya jelas: nama produk, base, warna dan ukuran sama dengan yang disebut. Kumpulkan semua yang jelas dalam satu panggilan.
4. Kalau ragu (beberapa kandidat mirip, base atau ukuran tidak disebut, atau tidak ada yang cocok), jangan dicatat. Tanyakan balik dengan pilihan bernomor dari hasil cari_barang.
5. Koreksi ("yang tadi salah", "harusnya 7"): lihat draf di konteks, lalu catat ulang dengan angka baru (menimpa) atau hapus_hitungan bila barangnya salah.
6. Foto: kalau ada gambar catatan atau daftar stok dari SPB, baca setiap baris barang dan angkanya, lalu perlakukan seperti laporan teks. Baris yang tulisannya tidak terbaca jangan ditebak; sebutkan dan tanyakan.
7. Jangan mengarang angka. Hanya bilangan bulat 0 atau lebih.

B. Menjawab pertanyaan dengan alat baca. Alat ini tidak mengubah apa pun.
- Sisa stok dan harga: cek_stok. Kalau beberapa barang mirip, sebutkan semuanya dengan stoknya.
- Riwayat keluar masuk barang: riwayat_stok (pakai id dari cek_stok).
- Piutang pelanggan: cek_piutang, dengan nama pelanggan atau kosong untuk daftar terbesar.
- Antaran hari ini: antaran_hari_ini.
- Ringkasan penjualan, kas dan saldo hari ini: ringkasan_hari_ini (hanya ada untuk admin).
Jawab hanya dari hasil alat. Kalau datanya tidak ada atau alatnya tidak tersedia untuk pengguna ini, katakan begitu.
Pertanyaan stok berarti stok sistem di billy; sebutkan bahwa itu stok sistem, bukan hitungan fisik.

Balas singkat dalam Bahasa Indonesia, teks biasa tanpa format markdown. Uang ditulis seperti Rp 1.250.000.
- Barang yang dicatat: satu baris per barang, "✓ NAMA BARANG: jumlah", lalu nomor draf, misalnya "Masuk draf OP-261119-0002, admin memposting di billy."
- Pertanyaan untuk yang ragu: pilihan bernomor.
Kalau pesan di luar dua pekerjaan ini, jelaskan singkat apa yang bisa kamu bantu.`;

export interface StockAgentImage {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  data: string;
}

export interface StockAgentInput {
  db: Db;
  actor: Actor;
  text: string;
  lastReply: string;
  images?: StockAgentImage[];
}

/** A tool's own failure (unknown product, product outside the brand) goes back to the model as text it can act on. */
const guarded =
  <A>(run: (args: A) => Promise<unknown>) =>
  async (args: A) => {
    try {
      return JSON.stringify(await run(args));
    } catch (err) {
      if (err instanceof DomainError) return `GAGAL: ${err.message}`;
      throw err;
    }
  };

/** The tools this user may call: recording counts and reading for admin and staff, the money summary for admin only. */
function agentTools(db: Db, actor: Actor) {
  const tools = [
    betaZodTool({
      name: "cari_barang",
      description:
        "Cari produk satu brand yang paling mirip dengan kata-kata staf, untuk mencatat hitungan. Mengembalikan sampai 6 kandidat (id, nama, satuan, skor 0-1), terbaik dulu. Base dan ukuran yang beda tidak ikut.",
      inputSchema: z.object({
        kategori_id: z.string().describe("id brand dari daftar brand di konteks"),
        kata: z.string().describe("nama barang seperti ditulis staf, termasuk base/warna dan ukuran"),
      }),
      run: guarded(({ kategori_id, kata }) => findProducts(db, kategori_id, kata)),
    }),
    betaZodTool({
      name: "catat_hitungan",
      description:
        "Catat sisa stok fisik ke draf opname brand ini (dibuat otomatis bila belum ada). Menimpa hitungan lama barang yang sama. Hanya untuk barang yang cocoknya jelas.",
      inputSchema: z.object({
        kategori_id: z.string(),
        barang: z
          .array(z.object({ product_id: z.string().describe("id dari cari_barang"), jumlah: z.number().int().min(0) }))
          .min(1),
      }),
      run: guarded(({ kategori_id, barang }) =>
        recordCounts(
          db,
          actor,
          kategori_id,
          barang.map((b) => ({ productId: b.product_id, qty: b.jumlah })),
        ),
      ),
    }),
    betaZodTool({
      name: "hapus_hitungan",
      description: "Hapus hitungan yang salah dari draf opname brand ini, sehingga barang itu kembali belum dihitung.",
      inputSchema: z.object({ kategori_id: z.string(), product_ids: z.array(z.string()).min(1) }),
      run: guarded(({ kategori_id, product_ids }) => clearCounts(db, actor, kategori_id, product_ids)),
    }),
    betaZodTool({
      name: "cek_stok",
      description:
        "Stok sistem saat ini dan harga jual dari sampai 5 produk yang paling mirip dengan kata-kata pengguna, di semua brand atau satu brand. Tidak mengubah apa pun.",
      inputSchema: z.object({
        kata: z.string().describe("nama barang, base/warna, ukuran"),
        kategori_id: z.string().optional().describe("id brand bila pengguna menyebut brand"),
      }),
      run: guarded(({ kata, kategori_id }) => stockLookup(db, actor.role, kata, kategori_id)),
    }),
    betaZodTool({
      name: "riwayat_stok",
      description: "Pergerakan stok terbaru satu produk (pembelian, penjualan, opname), terbaru dulu, dengan stok setelah tiap pergerakan.",
      inputSchema: z.object({
        product_id: z.string().describe("id dari cek_stok"),
        jumlah: z.number().int().min(1).max(30).optional().describe("berapa pergerakan, default 10"),
      }),
      run: guarded(({ product_id, jumlah }) => stockHistory(db, product_id, jumlah)),
    }),
    betaZodTool({
      name: "cek_piutang",
      description:
        "Faktur penjualan yang belum lunas. Dengan nama pelanggan: rincian fakturnya (sisa, jatuh tempo, lewat berapa hari). Tanpa nama: 10 pelanggan dengan piutang terbesar dan totalnya.",
      inputSchema: z.object({ pelanggan: z.string().optional().describe("nama atau sebagian nama pelanggan") }),
      run: guarded(({ pelanggan }) => receivables(db, pelanggan)),
    }),
    betaZodTool({
      name: "antaran_hari_ini",
      description: "Daftar antaran hari ini: yang menunggu, di jalan, sudah sampai, atau batal, dengan pelanggan, alamat, sopir dan barangnya.",
      inputSchema: z.object({}),
      run: guarded(() => deliveriesToday(db)),
    }),
  ];
  if (actor.role !== "admin") return tools;
  return [
    ...tools,
    betaZodTool({
      name: "ringkasan_hari_ini",
      description: "Ringkasan hari ini untuk pemilik: penjualan, laba kotor, kas masuk dan keluar, piutang, hutang jatuh tempo, dan saldo tiap akun.",
      inputSchema: z.object({}),
      run: guarded(() => dailySummary(db, actor.role)),
    }),
  ];
}

async function context(db: Db, actor: Actor, text: string, lastReply: string) {
  const brands = await brandList(db);
  return [
    `Pengguna ini: ${actor.role === "admin" ? "admin (pemilik)" : "staf kantor"}.`,
    `Daftar brand (nama: id):\n${brands.map((b) => `- ${b.name}: ${b.id}`).join("\n") || "- belum ada brand"}`,
    `Draf opname yang sedang terbuka:\n${await draftsSummary(db)}`,
    `Balasan terakhirmu ke pengguna ini:\n${lastReply || "(belum ada)"}`,
    `Pesan pengguna:\n${text || "(hanya foto, tanpa teks)"}`,
  ].join("\n\n");
}

/**
 * One Telegram message, one agent run: Claude reads the message (and any photo) with the brands and open
 * drafts, calls the tools above, and returns the reply to send. Only the last reply text carries over.
 */
export async function runStockAgent({ db, actor, text, lastReply, images = [] }: StockAgentInput, client = new Anthropic()): Promise<string> {
  const content: BetaContentBlockParam[] = [
    ...images.map((img): BetaContentBlockParam => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } })),
    { type: "text", text: await context(db, actor, text, lastReply) },
  ];
  const final = await client.beta.messages.toolRunner({
    model: STOCK_AGENT_MODEL,
    max_tokens: 16000,
    max_iterations: 10,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    cache_control: { type: "ephemeral" },
    system: SYSTEM,
    tools: agentTools(db, actor),
    messages: [{ role: "user", content }],
  });
  if (final.stop_reason === "refusal") return "Maaf, pesan ini tidak bisa saya proses. Coba tulis ulang.";
  const reply = final.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
  return reply || "Maaf, saya belum bisa memproses pesan itu. Coba tulis ulang.";
}
