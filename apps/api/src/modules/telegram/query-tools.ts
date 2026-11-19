import { businessDate, DomainError, type Role } from "@billy/core";
import { type Db, products, salesInvoices } from "@billy/db";
import { and, eq, isNull } from "drizzle-orm";
import { rankProducts } from "../../lib/product-match.ts";
import { getBoard } from "../deliveries/service.ts";
import { dashboard } from "../insights/service.ts";
import { stockByProduct } from "../products/service.ts";
import { invoicesWithState } from "../sales/service.ts";
import { listMovements } from "../stock/service.ts";

/**
 * Read-only answers for the Telegram bot, each built on the query the matching web page uses, so the
 * bot and billy never disagree. Nothing here writes. Cost prices and money totals are admin only.
 */

const DETAIL_INVOICES = 8;
const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** Current stock of the products closest to the words, optionally within one brand. */
export async function stockLookup(db: Db, role: Role, text: string, categoryId?: string) {
  const stock = stockByProduct(db);
  const pool = await db
    .select({
      id: products.id,
      name: products.name,
      variant: products.variant,
      unit: products.unit,
      sellPrice: products.sellPrice,
      costPrice: products.costPrice,
      minStock: products.minStock,
      stock: stock.stock,
    })
    .from(products)
    .leftJoin(stock, eq(stock.productId, products.id))
    .where(and(eq(products.active, true), categoryId ? eq(products.categoryId, categoryId) : undefined));
  const named = pool.map((p) => ({ ...p, name: `${p.name} ${p.variant}`.trim() }));
  return rankProducts(text, named)
    .slice(0, 5)
    .map(({ product: p, score }) => ({
      id: p.id,
      nama: p.name,
      satuan: p.unit,
      stok: p.stock ?? 0,
      stok_minimum: p.minStock,
      harga_jual: p.sellPrice,
      ...(role === "admin" && { harga_modal: p.costPrice }),
      skor: Math.round(score * 100) / 100,
    }));
}

const reasonLabels = { purchase: "pembelian", sale: "faktur", pos: "kasir", adjustment: "penyesuaian/opname", reversal: "pembatalan" } as const;

/** The product's latest stock movements, newest first, with the stock after each. */
export async function stockHistory(db: Db, productId: string, limit = 10) {
  const { rows } = await listMovements(db, { q: "", productId, page: 1, pageSize: limit });
  if (rows.length === 0) {
    const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId));
    if (!product) throw new DomainError("not_found", "Barang tidak ditemukan");
  }
  return rows.map((r) => ({
    tanggal: r.date,
    jumlah: r.qty,
    jenis: reasonLabels[r.reason],
    dokumen: r.sourceNumber,
    catatan: r.note || null,
    oleh: r.createdByName,
    stok_setelah: r.runningStock,
  }));
}

/**
 * Unpaid faktur grouped by customer, largest balance first. With a name, only customers whose name holds
 * every word, each with its total, overdue total and its 8 most overdue faktur.
 */
export async function receivables(db: Db, customer?: string) {
  const today = businessDate();
  const open = (await invoicesWithState(db, isNull(salesInvoices.voidedAt))).filter((r) => r.state.outstanding > 0);
  const wanted = words(customer ?? "");
  const byCustomer = new Map<string, { pelanggan: string; total: number; faktur: { nomor: string; tanggal: string; jatuh_tempo: string; sisa: number; lewat_hari: number }[] }>();
  for (const r of open) {
    if (wanted.length && !wanted.every((w) => r.customerName.toLowerCase().includes(w))) continue;
    const entry = byCustomer.get(r.customerId) ?? { pelanggan: r.customerName, total: 0, faktur: [] };
    entry.total += r.state.outstanding;
    entry.faktur.push({ nomor: r.number, tanggal: r.date, jatuh_tempo: r.dueDate, sisa: r.state.outstanding, lewat_hari: Math.max(0, daysBetween(r.dueDate, today)) });
    byCustomer.set(r.customerId, entry);
  }
  const customers = [...byCustomer.values()].sort((a, b) => b.total - a.total);
  return {
    per_tanggal: today,
    jumlah_pelanggan: customers.length,
    total_piutang: customers.reduce((n, c) => n + c.total, 0),
    pelanggan: customers.slice(0, customer ? 5 : 10).map((c) =>
      customer
        ? {
            pelanggan: c.pelanggan,
            total: c.total,
            jumlah_faktur: c.faktur.length,
            lewat_tempo: c.faktur.reduce((n, f) => n + (f.lewat_hari > 0 ? f.sisa : 0), 0),
            // A big customer has hundreds of faktur; the most overdue are the ones to chase.
            faktur_paling_lama: [...c.faktur].sort((a, b) => b.lewat_hari - a.lewat_hari).slice(0, DETAIL_INVOICES),
          }
        : { pelanggan: c.pelanggan, total: c.total, jumlah_faktur: c.faktur.length },
    ),
  };
}

const deliveryStatus = { waiting: "menunggu", on_the_way: "di jalan", delivered: "sampai", cancelled: "batal" } as const;

/** Today's delivery board: what waits, what is on the road, what arrived or was cancelled today. */
export async function deliveriesToday(db: Db) {
  const board = await getBoard(db);
  return board.deliveries.map((d) => ({
    status: deliveryStatus[d.status],
    pelanggan: d.customerName,
    alamat: d.address,
    nota: d.posSaleNumber ?? d.salesInvoiceNumber,
    sopir: d.driverName ?? (d.courier === "ojol" ? "ojol" : null),
    barang: d.items,
    alasan_batal: d.cancelReason,
  }));
}

/** Admin only: today's sales, profit, cash flow, piutang and account balances, as on the Overview page. */
export async function dailySummary(db: Db, role: Role) {
  if (role !== "admin") throw new DomainError("forbidden", "Ringkasan keuangan hanya untuk admin");
  const today = businessDate();
  const d = await dashboard(db, { from: today, to: today, weeks: "12" });
  return {
    tanggal: today,
    penjualan: d.current.sales,
    penjualan_kasir: d.current.posSales,
    penjualan_faktur: d.current.invoiceSales,
    laba_kotor: d.current.profit,
    kas_masuk: d.current.incoming,
    kas_keluar: d.current.outgoing,
    piutang: d.current.receivables,
    piutang_lewat_tempo: d.current.overdue,
    hutang_jatuh_tempo: d.current.duePayables,
    saldo: d.balances.map((a) => ({ akun: a.name, saldo: a.balance })),
    total_saldo: d.totalBalance,
  };
}
