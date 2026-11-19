import { DomainError } from "@billy/core";
import type { Db } from "@billy/db";
import OpenAI from "openai";
import type { NamespaceTool, Response, ResponseInputContent, ResponseInputItem, ResponseStreamEvent } from "openai/resources/responses/responses";
import { z } from "zod";
import type { Actor } from "../../env.ts";
import { ChatgptSignInRequired } from "../../lib/chatgpt-oauth.ts";
import { aiBearer, type Integrations } from "../integrations/config.ts";
import { dailySummary, deliveriesToday, receivables, stockHistory, stockLookup } from "./query-tools.ts";
import { loadPending, pendingSummary, prepareClears, prepareCounts } from "./pending.ts";
import { brandList, draftsSummary, findProducts } from "./stock-tools.ts";

/** Stable across requests (no dates, no data), so it caches; everything that changes goes in the user message. */
const SYSTEM = `Kamu asisten toko cat di Telegram untuk admin dan staf kantor. Ada dua jenis pekerjaan.

A. Mencatat laporan SPB (petugas dari pabrik cat) tentang sisa stok fisik di rak, sebagai hitungan di draf stok opname brand itu. Admin memeriksa dan memposting draf di aplikasi billy; kamu tidak pernah mengubah stok langsung.
1. Tentukan brand dari pesan dan daftar brand di konteks. Kalau brandnya tidak jelas, tanyakan.
2. Untuk setiap barang yang disebut, panggil cari_barang dengan kata-kata staf (nama, base, warna, ukuran). Ukuran: 2,5 L / 5 KG / galon = GALON; 20 L / 25 KG / pail = PAIL; 1 L / 1 KG = LITER.
3. Siapkan dengan catat_hitungan hanya barang yang cocoknya jelas: nama produk, base, warna dan ukuran sama dengan yang disebut. Kumpulkan semua yang jelas dalam satu panggilan. Alat ini belum menyimpan: billy menampilkan daftarnya sendiri dengan tombol Simpan dan Batal, dan baru tersimpan setelah pengguna menekan Simpan.
4. Kalau ragu (beberapa kandidat mirip, base atau ukuran tidak disebut, atau tidak ada yang cocok), jangan dicatat. Tanyakan balik dengan pilihan bernomor dari hasil cari_barang.
5. Koreksi ("yang tadi salah", "harusnya 7"): lihat yang menunggu konfirmasi dan draf di konteks, lalu panggil catat_hitungan lagi dengan angka baru (menimpa) atau hapus_hitungan bila barangnya salah. Daftar konfirmasi diperbarui otomatis.
6. Foto: kalau ada gambar catatan atau daftar stok dari SPB, baca setiap baris barang dan angkanya, lalu perlakukan seperti laporan teks. Baris yang tulisannya tidak terbaca jangan ditebak; sebutkan dan tanyakan.
7. Jangan mengarang angka. Hanya bilangan bulat 0 atau lebih.

B. Menjawab pertanyaan dengan alat baca. Alat ini tidak mengubah apa pun.
- Sisa stok dan harga: cek_stok. Kalau beberapa barang mirip, sebutkan semuanya dengan stoknya.
- Riwayat keluar masuk barang: riwayat_stok (pakai id dari cek_stok).
- Piutang pelanggan: cek_piutang, dengan nama pelanggan atau kosong untuk daftar terbesar.
- Antaran hari ini: antaran_hari_ini.
- Ringkasan penjualan, kas dan saldo hari ini: ringkasan_hari_ini (hanya ada untuk admin).
Jawab hanya dari hasil alat. Kalau datanya tidak ada atau alatnya tidak tersedia untuk pengguna ini, katakan begitu.
Pertanyaan stok berarti stok sistem di billy, bukan hitungan fisik.

Gaya balasan: Bahasa Indonesia, teks biasa tanpa markdown, sesingkat mungkin.
- Langsung ke isi. Tanpa salam, tanpa "Berikut", "Tentu", "Baik", tanpa judul atau label seperti "Status:" atau "Hasil:", tanpa penutup atau tawaran bantuan.
- Satu baris per barang atau per hal. Uang ditulis seperti Rp 1.250.000.
- Jangan ulangi pertanyaan pengguna. Jangan jelaskan cara kerjamu.

Bentuk yang dipakai:
Setelah catat_hitungan atau hapus_hitungan: jangan tulis ulang daftar barangnya dan jangan bilang sudah tersimpan, karena billy menampilkan daftar dan tombol Simpan sendiri. Tulis hanya hal lain yang perlu (pertanyaan untuk barang yang ragu), atau kosongkan balasan.

Stok, tanpa baris judul (ini stok sistem billy, bukan hitungan rak):
CATYLAC EXTERIOR BASE A GALON: 55 galon

Riwayat (terbaru dulu): tanggal, perubahan, dokumen, stok setelahnya, satu baris tiap pergerakan:
13 Nov +90 penyesuaian → 101

Pilihan saat ragu, satu baris pertanyaan lalu pilihan bernomor, tiap pilihan nama barang lengkap:
Catylac glow 3, yang mana?
1. CATYLAC GLOW BASE A GALON
2. CATYLAC GLOW BASE B GALON

Piutang satu pelanggan: baris pertama nama, total, jumlah faktur dan total lewat tempo; lalu satu baris per faktur dari hasil alat: nomor, sisa, lewat berapa hari.

Kalau ada yang perlu diperhatikan (harga Rp 1, stok minus), tulis satu baris pendek di akhir.
Kalau pesan di luar pekerjaan ini, jawab satu kalimat apa yang bisa kamu bantu.`;

export interface StockAgentImage {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  data: string;
}

export interface StockAgentInput {
  db: Db;
  actor: Actor;
  text: string;
  /** The Telegram chat, where prepared changes wait for confirmation. */
  chatId: string;
  lastReply: string;
  images?: StockAgentImage[];
}

/** One tool, written once and handed to whichever AI is configured. */
interface AgentTool {
  name: string;
  description: string;
  inputSchema: z.ZodObject;
  run: (args: Record<string, unknown>) => Promise<string>;
}

/**
 * Defines a tool whose own failure (unknown product, product outside the brand) goes back to the model
 * as text it can act on, instead of ending the run.
 */
const tool = <S extends z.ZodObject>(def: { name: string; description: string; inputSchema: S; run: (args: z.infer<S>) => Promise<unknown> }): AgentTool =>
  ({
    ...def,
    run: async (args: z.infer<S>) => {
      try {
        return JSON.stringify(await def.run(args));
      } catch (err) {
        if (err instanceof DomainError) return `GAGAL: ${err.message}`;
        throw err;
      }
    },
  }) as unknown as AgentTool;

/** The tools this user may call: preparing counts and reading for admin and staff, the money summary for admin only. Nothing here writes to the stock opname without the user's confirmation. */
function agentTools(db: Db, actor: Actor, chatId: string) {
  const tools = [
    tool({
      name: "cari_barang",
      description:
        "Cari produk satu brand yang paling mirip dengan kata-kata staf, untuk mencatat hitungan. Mengembalikan sampai 6 kandidat (id, nama, satuan, skor 0-1), terbaik dulu. Base dan ukuran yang beda tidak ikut.",
      inputSchema: z.object({
        kategori_id: z.string().describe("id brand dari daftar brand di konteks"),
        kata: z.string().describe("nama barang seperti ditulis staf, termasuk base/warna dan ukuran"),
      }),
      run: ({ kategori_id, kata }) => findProducts(db, kategori_id, kata),
    }),
    tool({
      name: "catat_hitungan",
      description:
        "Siapkan sisa stok fisik untuk draf opname brand ini. BELUM menyimpan: pengguna harus menekan Simpan dulu. Barang yang disiapkan lagi diganti angkanya. Hanya untuk barang yang cocoknya jelas.",
      inputSchema: z.object({
        kategori_id: z.string(),
        barang: z
          .array(z.object({ product_id: z.string().describe("id dari cari_barang"), jumlah: z.number().int().min(0) }))
          .min(1),
      }),
      run: async ({ kategori_id, barang }) => {
        await prepareCounts(db, chatId, kategori_id, barang.map((b) => ({ productId: b.product_id, qty: b.jumlah })));
        return "Disiapkan, belum disimpan. Billy menampilkan daftar dengan tombol Simpan.";
      },
    }),
    tool({
      name: "hapus_hitungan",
      description: "Siapkan penghapusan hitungan yang salah (dari draf, atau dari daftar yang belum disimpan). BELUM menghapus dari draf: pengguna harus menekan Simpan dulu.",
      inputSchema: z.object({ kategori_id: z.string(), product_ids: z.array(z.string()).min(1) }),
      run: async ({ kategori_id, product_ids }) => {
        await prepareClears(db, chatId, kategori_id, product_ids);
        return "Disiapkan, belum disimpan. Billy menampilkan daftar dengan tombol Simpan.";
      },
    }),
    tool({
      name: "cek_stok",
      description:
        "Stok sistem saat ini dan harga jual dari sampai 5 produk yang paling mirip dengan kata-kata pengguna, di semua brand atau satu brand. Tidak mengubah apa pun.",
      inputSchema: z.object({
        kata: z.string().describe("nama barang, base/warna, ukuran"),
        kategori_id: z.string().optional().describe("id brand bila pengguna menyebut brand"),
      }),
      run: ({ kata, kategori_id }) => stockLookup(db, actor.role, kata, kategori_id),
    }),
    tool({
      name: "riwayat_stok",
      description: "Pergerakan stok terbaru satu produk (pembelian, penjualan, opname), terbaru dulu, dengan stok setelah tiap pergerakan.",
      inputSchema: z.object({
        product_id: z.string().describe("id dari cek_stok"),
        jumlah: z.number().int().min(1).max(30).optional().describe("berapa pergerakan, default 10"),
      }),
      run: ({ product_id, jumlah }) => stockHistory(db, product_id, jumlah),
    }),
    tool({
      name: "cek_piutang",
      description:
        "Faktur penjualan yang belum lunas. Dengan nama pelanggan: total, jumlah faktur, total lewat tempo, dan 8 faktur paling lama lewat tempo. Tanpa nama: 10 pelanggan dengan piutang terbesar.",
      inputSchema: z.object({ pelanggan: z.string().optional().describe("nama atau sebagian nama pelanggan") }),
      run: ({ pelanggan }) => receivables(db, pelanggan),
    }),
    tool({
      name: "antaran_hari_ini",
      description: "Daftar antaran hari ini: yang menunggu, di jalan, sudah sampai, atau batal, dengan pelanggan, alamat, sopir dan barangnya.",
      inputSchema: z.object({}),
      run: () => deliveriesToday(db),
    }),
  ];
  if (actor.role !== "admin") return tools;
  return [
    ...tools,
    tool({
      name: "ringkasan_hari_ini",
      description: "Ringkasan hari ini untuk pemilik: penjualan, laba kotor, kas masuk dan keluar, piutang, hutang jatuh tempo, dan saldo tiap akun.",
      inputSchema: z.object({}),
      run: () => dailySummary(db, actor.role),
    }),
  ];
}

async function context(db: Db, actor: Actor, chatId: string, text: string, lastReply: string) {
  const brands = await brandList(db);
  return [
    `Pengguna ini: ${actor.role === "admin" ? "admin (pemilik)" : "staf kantor"}.`,
    `Daftar brand (nama: id):\n${brands.map((b) => `- ${b.name}: ${b.id}`).join("\n") || "- belum ada brand"}`,
    `Draf opname yang sedang terbuka:\n${await draftsSummary(db)}`,
    `Menunggu konfirmasi pengguna:\n${pendingSummary(await loadPending(db, chatId))}`,
    `Balasan terakhirmu ke pengguna ini:\n${lastReply || "(belum ada)"}`,
    `Pesan pengguna:\n${text || "(hanya foto, tanpa teks)"}`,
  ].join("\n\n");
}

const NO_REPLY = "Maaf, saya belum bisa memproses pesan itu. Coba tulis ulang.";
const NOT_READY = "Bot belum siap: admin perlu masuk dengan ChatGPT (atau mengisi kunci OpenAI) dan memilih model di billy, Pengaturan, Koneksi.";

/**
 * One Telegram message, one agent run on ChatGPT: it reads the message (and any photo) with the brands
 * and open drafts, calls the tools above, and returns the reply to send. Only the last reply text carries
 * over between messages. `bearer` is the ChatGPT session's access token, or an OpenAI API key.
 */
export async function runStockAgent(input: StockAgentInput, ai: Integrations["ai"], bearer: (db: Db) => Promise<string | null> = aiBearer): Promise<string> {
  if (!ai.auth || !ai.model) return NOT_READY;
  let token: string | null;
  try {
    token = await bearer(input.db);
  } catch (err) {
    if (err instanceof ChatgptSignInRequired) return err.message;
    throw err;
  }
  if (!token) return NOT_READY;
  const prompt = await context(input.db, input.actor, input.chatId, input.text, input.lastReply);
  return runChatgpt(new OpenAI({ apiKey: token, maxRetries: 1, timeout: 90_000 }), ai.model, prompt, input.images ?? [], agentTools(input.db, input.actor, input.chatId));
}

const MAX_ROUNDS = 10;

/**
 * ChatGPT through the Responses API, in the shape ChatGPT plan usage requires: streamed, `store: false`,
 * instructions instead of a system message, tools grouped in one namespace, and the whole history (with
 * encrypted reasoning) sent back each round instead of `previous_response_id`.
 */
export async function runChatgpt(client: OpenAI, model: string, prompt: string, images: StockAgentImage[], tools: AgentTool[]) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const content: ResponseInputContent[] = [
    ...images.map((img): ResponseInputContent => ({ type: "input_image", detail: "auto", image_url: `data:${img.mediaType};base64,${img.data}` })),
    { type: "input_text", text: prompt },
  ];
  const input: ResponseInputItem[] = [{ role: "user", content }];
  const namespace: NamespaceTool = {
    type: "namespace",
    name: "billy",
    description: "Alat toko: mencari dan mencatat stok opname, cek stok, riwayat, piutang, antaran, ringkasan.",
    tools: tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: z.toJSONSchema(t.inputSchema), strict: false })),
  };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await finalResponse(
      await client.responses.create({
        model,
        instructions: SYSTEM,
        input,
        tools: [namespace],
        reasoning: { effort: "low" },
        store: false,
        stream: true,
        include: ["reasoning.encrypted_content"],
      }),
    );
    if (response?.status !== "completed") return NO_REPLY;
    const calls = response.output.filter((item) => item.type === "function_call");
    if (calls.length === 0) {
      const refused = response.output.some((item) => item.type === "message" && item.content.some((c) => c.type === "refusal"));
      if (refused) return "Maaf, pesan ini tidak bisa saya proses. Coba tulis ulang.";
      const text = response.output.flatMap((item) => (item.type === "message" ? item.content.flatMap((c) => (c.type === "output_text" ? [c.text] : [])) : []));
      // May be empty: after preparing a change the agent can leave the talking to billy's confirmation.
      return text.join("\n").trim();
    }
    input.push(...(response.output as ResponseInputItem[]));
    for (const call of calls) input.push({ type: "function_call_output", call_id: call.call_id, output: await runToolCall(byName.get(call.name), call.arguments) });
  }
  return NO_REPLY;
}

/**
 * The finished response from the raw event stream. Read raw because ChatGPT plan responses add events
 * (such as `response.metadata`) that the SDK's stream helper rejects; only the final event matters here.
 */
async function finalResponse(events: AsyncIterable<ResponseStreamEvent>): Promise<Response | null> {
  for await (const event of events) {
    if (event.type === "response.completed" || event.type === "response.incomplete" || event.type === "response.failed") return event.response;
  }
  return null;
}

/** Runs one call the model asked for; a made-up tool or invalid arguments go back to the model as an error it can fix. */
async function runToolCall(t: AgentTool | undefined, rawArgs: string) {
  if (!t) return "GAGAL: alat tidak dikenal";
  let args: unknown;
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {
    return "GAGAL: argumen bukan JSON yang valid";
  }
  const parsed = t.inputSchema.safeParse(args);
  if (!parsed.success) return `GAGAL: argumen tidak valid (${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")})`;
  return t.run(parsed.data);
}
