import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { DomainError } from "@billy/core";
import type { Db } from "@billy/db";
import { z } from "zod";
import type { Actor } from "../../env.ts";
import { brandList, clearCounts, draftsSummary, findProducts, recordCounts } from "./stock-tools.ts";

export const STOCK_AGENT_MODEL = "claude-opus-5-5";

/** Stable across requests (no dates, no data), so it caches; everything that changes goes in the user message. */
const SYSTEM = `Kamu asisten stok di toko cat. Staf toko meneruskan laporan SPB (petugas dari pabrik cat) tentang sisa stok fisik barang di rak, biasanya satu brand per pesan. Tugasmu mencatat angka itu sebagai hitungan di draf stok opname brand tersebut. Admin akan memeriksa dan memposting draf itu di aplikasi billy; kamu tidak pernah mengubah stok langsung.

Cara kerja:
1. Tentukan brand dari pesan dan daftar brand di konteks. Kalau brandnya tidak jelas, tanyakan.
2. Untuk setiap barang yang disebut, panggil cari_barang dengan kata-kata staf (nama, base, warna, ukuran). Ukuran: 2,5 L / 5 KG / galon = GALON; 20 L / 25 KG / pail = PAIL; 1 L / 1 KG = LITER.
3. Catat dengan catat_hitungan hanya barang yang cocoknya jelas: nama produk, base, warna dan ukuran sama dengan yang disebut. Kumpulkan semua yang jelas dalam satu panggilan.
4. Kalau ragu (beberapa kandidat mirip, base atau ukuran tidak disebut, atau tidak ada yang cocok), jangan dicatat. Tanyakan balik dengan pilihan bernomor dari hasil cari_barang.
5. Koreksi ("yang tadi salah", "harusnya 7"): lihat draf di konteks, lalu catat ulang dengan angka baru (menimpa) atau hapus_hitungan bila barangnya salah.
6. Jawaban staf berupa nomor pilihan atau "ya" merujuk ke balasan terakhirmu di konteks.
7. Jangan mengarang angka. Hanya bilangan bulat 0 atau lebih.

Balas singkat dalam Bahasa Indonesia, teks biasa tanpa format markdown:
- Barang yang dicatat: satu baris per barang, "✓ NAMA BARANG: jumlah".
- Pertanyaan untuk yang ragu, dengan pilihan bernomor.
- Tutup dengan nomor draf opname, misalnya "Masuk draf OP-261119-0002, admin memposting di billy."
Kalau pesan bukan laporan stok, jelaskan singkat bahwa kamu hanya mencatat sisa stok dari SPB.`;

export interface StockAgentInput {
  db: Db;
  actor: Actor;
  text: string;
  lastReply: string;
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

function stockTools(db: Db, actor: Actor) {
  return [
    betaZodTool({
      name: "cari_barang",
      description:
        "Cari produk satu brand yang paling mirip dengan kata-kata staf. Mengembalikan sampai 6 kandidat (id, nama, satuan, skor 0-1), terbaik dulu. Base dan ukuran yang beda tidak ikut.",
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
  ];
}

async function context(db: Db, text: string, lastReply: string) {
  const brands = await brandList(db);
  return [
    `Daftar brand (nama: id):\n${brands.map((b) => `- ${b.name}: ${b.id}`).join("\n") || "- belum ada brand"}`,
    `Draf opname yang sedang terbuka:\n${await draftsSummary(db)}`,
    `Balasan terakhirmu ke staf ini:\n${lastReply || "(belum ada)"}`,
    `Pesan staf:\n${text}`,
  ].join("\n\n");
}

/**
 * One staff message, one agent run: Claude reads the message with the brands and open drafts, calls the
 * tools above, and returns the reply to send. Nothing of earlier runs is replayed except the last reply text.
 */
export async function runStockAgent({ db, actor, text, lastReply }: StockAgentInput, client = new Anthropic()): Promise<string> {
  const final = await client.beta.messages.toolRunner({
    model: STOCK_AGENT_MODEL,
    max_tokens: 16000,
    max_iterations: 8,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    cache_control: { type: "ephemeral" },
    system: SYSTEM,
    tools: stockTools(db, actor),
    messages: [{ role: "user", content: await context(db, text, lastReply) }],
  });
  if (final.stop_reason === "refusal") return "Maaf, pesan ini tidak bisa saya proses. Coba tulis ulang laporan stoknya.";
  const reply = final.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
  return reply || "Maaf, saya belum bisa memproses pesan itu. Coba tulis ulang laporan stoknya.";
}
