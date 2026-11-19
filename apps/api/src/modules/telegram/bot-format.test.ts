import { describe, expect, it } from "vitest";
import { cleanReply, formatDeliveries, formatReceivables, formatSummary, menuAction, menuKeyboard, optionButtons } from "./bot-format.ts";

describe("bot replies", () => {
  it("keeps the money summary button for admins only", () => {
    const labels = (role: "admin" | "staff") => (menuKeyboard(role) as { keyboard: { text: string }[][] }).keyboard.flat().map((b) => b.text);
    expect(labels("admin")).toContain("📊 Ringkasan");
    expect(labels("staff")).not.toContain("📊 Ringkasan");
    expect(menuAction("🧾 Piutang")).toBe("receivables");
    expect(menuAction("piutang")).toBeNull();
  });

  it("turns numbered options into buttons, and leaves other replies alone", () => {
    expect(optionButtons("Catylac glow 3, yang mana?\n1. CATYLAC GLOW BASE A GALON\n2. CATYLAC GLOW BASE B GALON")).toEqual({
      inline_keyboard: [[{ text: "1. CATYLAC GLOW BASE A GALON", callback_data: "pilih:1" }], [{ text: "2. CATYLAC GLOW BASE B GALON", callback_data: "pilih:2" }]],
    });
    expect(optionButtons("✓ WEATHERSHIELD BASE A GALON: 6\nDraf OP-1")).toBeNull();
    expect(optionButtons("2. lompat\n3. tidak mulai dari satu")).toBeNull();
  });

  it("strips markdown the model adds anyway", () => {
    expect(cleanReply("**Stok** `CATYLAC`\n\n\n\n- satu\n## Judul")).toBe("Stok CATYLAC\n\n• satu\nJudul");
  });

  it("formats the direct answers compactly", () => {
    expect(formatDeliveries([])).toBe("Tidak ada antaran hari ini.");
    expect(
      formatDeliveries([
        { status: "di jalan", pelanggan: "Toko Jaya", alamat: "Jl. Mawar 3", nota: "C-1", sopir: "Anto", barang: [], alasan_batal: null },
        { status: "menunggu", pelanggan: "Pak Budi", alamat: "", nota: "C-2", sopir: null, barang: [], alasan_batal: null },
      ]),
    ).toBe("⏳ Menunggu (1)\n• Pak Budi\n🚚 Di jalan (1)\n• Toko Jaya · Jl. Mawar 3 · Anto");
    expect(
      formatReceivables({ per_tanggal: "2026-11-19", jumlah_pelanggan: 2, total_piutang: 150_000, pelanggan: [{ pelanggan: "Toko A", total: 100_000, jumlah_faktur: 2 }, { pelanggan: "Toko B", total: 50_000, jumlah_faktur: 1 }] }),
    ).toBe("Piutang Rp 150.000 · 2 pelanggan\n1. Toko A Rp 100.000 · 2 faktur\n2. Toko B Rp 50.000 · 1 faktur");
    const summary = formatSummary(({
      tanggal: "2026-11-19",
      penjualan: 300_000,
      penjualan_kasir: 200_000,
      penjualan_faktur: 100_000,
      laba_kotor: 60_000,
      kas_masuk: 250_000,
      kas_keluar: 40_000,
      piutang: 150_000,
      piutang_lewat_tempo: 0,
      hutang_jatuh_tempo: 0,
      saldo: [{ akun: "KAS", saldo: 1_000_000 }],
      total_saldo: 1_000_000,
    }) as unknown as Parameters<typeof formatSummary>[0]);
    expect(summary.split("\n")).toEqual([
      "19 Nov 2026",
      "Penjualan Rp 300.000 (kasir Rp 200.000, faktur Rp 100.000)",
      "Laba kotor Rp 60.000",
      "Kas masuk Rp 250.000 · keluar Rp 40.000",
      "Piutang Rp 150.000 · lewat tempo Rp 0",
      "Hutang jatuh tempo Rp 0",
      "",
      "KAS Rp 1.000.000",
      "Total saldo Rp 1.000.000",
    ]);
  });
});
