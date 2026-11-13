/**
 * Builds a fresh database from the legacy E-Jurnal export in .legacy/ (see tools/legacy/).
 * Every document goes through the same service functions the API uses, so totals, stock movements
 * and cash entries follow the app's rules. Rows a rule rejects are skipped and written to
 * .legacy/import-errors.jsonl with the reason.
 *
 *   pnpm --filter @billy/api import:legacy [dataDir]     (default .data/legacy; must not exist yet)
 */
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  accountInput,
  cashEntryInput,
  contactInput,
  expenseInput,
  invoiceBundleInput,
  posSaleInput,
  productInput,
  purchaseInput,
  purchasePaymentInput,
  salesInvoiceInput,
  salesPaymentInput,
  stockAdjustmentInput,
  uuidv7,
} from "@billy/core";
import { categories, createDb, products, settings, stockMovements, users } from "@billy/db";
import { sql } from "drizzle-orm";
import { hashPassword } from "../auth/password.ts";
import { createAccount, createCashEntry } from "../modules/cash/service.ts";
import { createContact } from "../modules/contacts/service.ts";
import { createExpense } from "../modules/expenses/service.ts";
import { createBundle } from "../modules/invoice-bundles/service.ts";
import { recordSale } from "../modules/pos/service.ts";
import { adjustStock, createProduct } from "../modules/products/service.ts";
import { createPurchase, getPurchase, payPurchase } from "../modules/purchases/service.ts";
import { createInvoice, getInvoice, recordPayment } from "../modules/sales/service.ts";
import { daysBetween, isoDate, money, normName, percentToBp, posNumber, receiptAmount, receiptLines, splitTint } from "./parse.ts";

type Row = string[];
interface Page {
  inputs: Record<string, string>;
  rows: Row[];
}
interface Detail {
  id: string;
  row: Row;
  pages: Record<string, Page>;
}

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const src = `${root}.legacy/`;
const dataDir = process.argv[2] ?? `${root}.data/legacy`;
if (existsSync(dataDir)) throw new Error(`${dataDir} already exists. Delete it first; the import always starts from an empty database.`);

const list = (name: string): Row[] => JSON.parse(readFileSync(`${src}lists/${name}.json`, "utf8"));
const details = (name: string): Detail[] => {
  const file = `${src}details/${name}.jsonl`;
  if (!existsSync(file)) return [];
  const byId = new Map<string, Detail>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    try {
      const d = JSON.parse(line) as Detail;
      byId.set(d.id, d);
    } catch {
      // partial line from an interrupted download
    }
  }
  return [...byId.values()];
};

const errorsFile = `${src}import-errors.jsonl`;
rmSync(errorsFile, { force: true });
const counts: Record<string, { ok: number; failed: number }> = {};
/** The app recomputes totals from the lines; a document whose legacy total disagrees is logged, not changed. */
function noteTotal(kind: string, ref: string, ours: number, legacy: string | undefined) {
  if (legacy !== undefined && ours !== money(legacy)) {
    appendFileSync(errorsFile, `${JSON.stringify({ kind: `${kind} total`, ref, error: `Recomputed ${ours}, legacy ${money(legacy)}` })}\n`);
  }
}
async function attempt(kind: string, ref: string, fn: () => Promise<unknown>) {
  const c = (counts[kind] ??= { ok: 0, failed: 0 });
  try {
    await fn();
    c.ok++;
  } catch (error) {
    c.failed++;
    const e = error as Error & { fields?: unknown };
    appendFileSync(errorsFile, `${JSON.stringify({ kind, ref, error: e.message, fields: e.fields })}\n`);
  }
  if ((c.ok + c.failed) % 1000 === 0) console.log(`  ${kind} ${c.ok + c.failed}`);
}

const database = await createDb({ dataDir });
await database.migrate();
const { db } = database;

// --- users and settings -----------------------------------------------------------------------
const [admin] = await db
  .insert(users)
  .values({
    username: "admin",
    name: "Pemilik",
    role: "admin",
    passwordHash: await hashPassword(process.env.SEED_ADMIN_PASSWORD ?? "admin12345"),
  })
  .returning();
const adminUser = { id: admin!.id, username: admin!.username, name: admin!.name, role: admin!.role };
// Shop contact details live in the gitignored .legacy/shop.json (copied from the legacy Pengaturan page).
const shop = existsSync(`${src}shop.json`) ? (JSON.parse(readFileSync(`${src}shop.json`, "utf8")) as Record<string, string>) : {};
await db.insert(settings).values({
  shopName: "Toko Cat Sumber Karya",
  address: shop.address ?? "",
  phone: shop.phone ?? "",
  whatsapp: shop.whatsapp ?? "",
  receiptFooter: shop.receiptFooter ?? "",
  posDeviceCode: "K1",
});

// --- master data ------------------------------------------------------------------------------
console.log("master data");
for (const [, name, description] of list("kategori")) {
  await db.insert(categories).values({ name: name!.trim(), description: description?.trim() ?? "" });
}

const accountByName = new Map<string, string>();
for (const [, code, name, kind] of list("akun")) {
  const account = await createAccount(
    db,
    accountInput.parse({
      code: code!.trim(),
      name: name!.trim(),
      kind: kind === "kas" ? "cash" : name!.trim() === "QR" ? "ewallet" : "bank",
    }),
  );
  accountByName.set(normName(name!), account.id);
}
// The ledger also names accounts the legacy account list no longer has (deleted there).
const jurnal = list("jurnal");
let extraAccounts = 0;
for (const name of new Set(jurnal.map((r) => normName(r[3] ?? "")).filter(Boolean))) {
  if (accountByName.has(name)) continue;
  const created = await createAccount(db, accountInput.parse({ code: `LEG-${++extraAccounts}`, name, kind: "bank" }));
  accountByName.set(name, created.id);
}
const kas = accountByName.get("KAS")!;
const account = (name: string | undefined) => accountByName.get(normName(name ?? "")) ?? kas;

const contactByName = { customer: new Map<string, string>(), supplier: new Map<string, string>() };
let extraContacts = 0;
const usedCodes = new Set<string>();
for (const [, , code, name, kind, phone, email] of list("kontak")) {
  const k = kind === "customer" ? "customer" : "supplier";
  await attempt("contacts", code!, async () => {
    // Legacy codes are not unique; a repeat gets a suffix.
    const unique = usedCodes.has(code!) ? `${code}-${usedCodes.size}` : code!;
    usedCodes.add(unique);
    const parsed = contactInput.safeParse({ code: unique, name, kind: k, phone: phone ?? "", email: email ?? "" });
    const row = await createContact(db, parsed.success ? parsed.data : contactInput.parse({ code: unique, name, kind: k, phone: phone ?? "" }));
    if (!contactByName[k].has(normName(name!))) contactByName[k].set(normName(name!), row.id);
  });
}
async function contactId(kind: "customer" | "supplier", name: string) {
  const key = normName(name);
  const found = contactByName[kind].get(key);
  if (found) return found;
  const row = await createContact(
    db,
    contactInput.parse({ code: `LEG-${kind === "customer" ? "C" : "S"}${++extraContacts}`, name: name.trim() || "Tanpa nama", kind }),
  );
  contactByName[kind].set(key, row.id);
  return row.id;
}

const productByName = new Map<string, string>();
const legacyStock = new Map<string, number>();
for (const [, name, , sell, cost, stock, unit] of list("produk")) {
  const key = normName(name!);
  if (productByName.has(key)) continue;
  await attempt("products", name!, async () => {
    const p = await createProduct(
      db,
      productInput.parse({
        code: null,
        barcode: null,
        name: name!.trim(),
        unit: unit?.trim() || "PCS",
        categoryId: null,
        sellPrice: Math.max(0, money(sell)),
        costPrice: Math.max(0, money(cost)),
        minStock: 0,
      }),
    );
    productByName.set(key, p.id);
    legacyStock.set(p.id, Number(stock) || 0);
  });
}
/** Matches a document line to a product; a name the product list no longer has becomes a new product. */
async function product(lineName: string, price: number): Promise<{ id: string; note: string }> {
  const exact = productByName.get(normName(lineName));
  if (exact) return { id: exact, note: "" };
  const { name, note } = splitTint(lineName);
  const base = productByName.get(normName(name));
  if (base) return { id: base, note };
  const p = await createProduct(
    db,
    productInput.parse({ code: null, barcode: null, name: lineName.trim(), unit: "PCS", categoryId: null, sellPrice: price, costPrice: 0, minStock: 0 }),
  );
  productByName.set(normName(lineName), p.id);
  return { id: p.id, note: "" };
}

/** Line rows of a sales or purchase detail page: NO, Nama, Qty, Harga, Jenis, %, Total Diskon, Subtotal, Total. */
const docLines = (page: Page) => page.rows.filter((r) => r.length >= 9 && /^\d+$/.test(r[0]!));
/** Payment rows of a history page: NO, No Faktur, Akun, Tanggal, Metode, Tagihan, Pembayaran, Sisa. */
const paymentRows = (page: Page | undefined) =>
  (page?.rows ?? []).filter((r) => r.length >= 8 && /^\d+$/.test(r[0]!) && money(r[6]) > 0);
const method = (text: string | undefined) => (normName(text ?? "") === "TRANSFER" ? "transfer" : "cash");
const terms = (date: string, due: string | undefined) => {
  try {
    const days = daysBetween(date, isoDate(due ?? ""));
    return Number.isFinite(days) ? Math.min(365, Math.max(0, days)) : 0;
  } catch {
    return 0;
  }
};
/**
 * A line's discount as gross minus the printed line total ("Total Harga"). The legacy "Total
 * Diskon" column is unreliable (sometimes far above the line), the line total is what was billed.
 */
const lineDiscount = (qty: number, price: number, lineTotal: string | undefined) =>
  Math.min(qty * price, Math.max(0, qty * price - money(lineTotal)));
/**
 * The document discount. The legacy "Jumlah Diskon" field is unreliable, so it is derived as
 * subtotal + PPN − total. When the legacy total is itself corrupt (the derived value falls outside
 * 0..subtotal), the discount percentage is used instead.
 */
function documentDiscount(h: Record<string, string>, lineTotals: number[]) {
  const subtotal = lineTotals.reduce((a, b) => a + b, 0);
  const derived = subtotal + money(h["Jumlah PPN"]) - money(h.total_tagihan);
  if (derived === 0) return { discountKind: "none" as const, discountValue: 0 };
  if (derived > 0 && derived <= subtotal) return { discountKind: "amount" as const, discountValue: derived };
  const bp = percentToBp(h.persentase_diskon);
  return bp > 0 && bp <= 10_000 ? { discountKind: "percent" as const, discountValue: bp } : { discountKind: "none" as const, discountValue: 0 };
}
const oldestFirst = <T extends { date: string }>(docs: T[]) => docs.sort((a, b) => a.date.localeCompare(b.date));

// --- purchases --------------------------------------------------------------------------------
console.log("purchases");
const purchases = oldestFirst(details("pembelian").map((d) => ({ ...d, date: isoDate(d.pages.detail!.inputs.tanggal_transaksi ?? d.row[5]!) })));
const purchaseIds = new Map<string, string>();
for (const d of purchases) {
  const h = d.pages.detail!.inputs;
  await attempt("purchases", h.kode_pembelian ?? d.id, async () => {
    const lines = [];
    for (const r of docLines(d.pages.detail!)) {
      const p = await product(r[1]!, money(r[3]));
      const qty = Math.max(1, Number(r[2]) || 1);
      lines.push({ productId: p.id, note: p.note, qty, unitCost: money(r[3]), discountAmount: lineDiscount(qty, money(r[3]), r[8]) });
    }
    const created = await createPurchase(
      db,
      purchaseInput.parse({
        supplierId: await contactId("supplier", h.nama_suppliyer ?? d.row[1]!),
        supplierInvoiceNumber: h.no_faktur ?? "",
        date: d.date,
        termsDays: terms(d.date, h.tgl_jatuh_tempo),
        ...documentDiscount(h, lines.map((l) => l.qty * l.unitCost - l.discountAmount)),
        taxRateBp: percentToBp(h["Persentase PPN"]),
        note: `Legacy ${h.kode_pembelian ?? ""}`.trim(),
        lines,
      }),
      admin!.id,
    );
    purchaseIds.set(d.id, created.id);
    noteTotal("purchases", h.kode_pembelian ?? d.id, created.total, h.total_tagihan);
  });
}

// --- sales invoices ---------------------------------------------------------------------------
console.log("sales");
const sales = oldestFirst(details("penjualan").map((d) => ({ ...d, date: isoDate(d.pages.detail!.inputs.tanggal_transaksi ?? d.row[3]!) })));
const salesIds = new Map<string, string>();
const salesByNumber = new Map<string, { id: string; customerId: string }>();
for (const d of sales) {
  const h = d.pages.detail!.inputs;
  await attempt("sales", h.no_faktur ?? d.id, async () => {
    const lines = [];
    for (const r of docLines(d.pages.detail!)) {
      const p = await product(r[1]!, money(r[3]));
      const qty = Math.max(1, Number(r[2]) || 1);
      lines.push({ productId: p.id, note: p.note, qty, unitPrice: money(r[3]), discountAmount: lineDiscount(qty, money(r[3]), r[8]) });
    }
    const customerId = await contactId("customer", h.nama_customer ?? d.row[1]!);
    const invoice = await createInvoice(
      db,
      salesInvoiceInput.parse({
        customerId,
        date: d.date,
        termsDays: terms(d.date, h.tgl_jatuh_tempo),
        ...documentDiscount(h, lines.map((l) => l.qty * l.unitPrice - l.discountAmount)),
        note: `Legacy ${h.no_faktur ?? ""}`.trim(),
        lines,
      }),
      admin!.id,
    );
    salesIds.set(d.id, invoice.id);
    noteTotal("sales", h.no_faktur ?? d.id, invoice.total, h.total_tagihan);
    salesByNumber.set(normName(h.no_faktur ?? ""), { id: invoice.id, customerId });
  });
}

// --- tukar faktur (before payments: a bundle only takes invoices still open) -------------------
console.log("invoice bundles");
const bundles = oldestFirst(
  details("tukar_faktur").map((d) => ({ ...d, date: /(\d{4}-\d{2}-\d{2})/.exec(d.pages.detail!.inputs.kode_tukar_faktur ?? "")?.[1] ?? "2023-01-01" })),
);
for (const d of bundles) {
  const h = d.pages.detail!.inputs;
  await attempt("bundles", h.kode_tukar_faktur ?? d.id, async () => {
    const invoices = d.pages.detail!.rows.filter((r) => /^\d+$/.test(r[0] ?? "")).flatMap((r) => salesByNumber.get(normName(r[1]!)) ?? []);
    if (!invoices.length) throw new Error("No imported invoice in this bundle");
    await createBundle(
      db,
      invoiceBundleInput.parse({
        customerId: invoices[0]!.customerId,
        date: d.date,
        note: `Legacy ${h.kode_tukar_faktur ?? ""}`.trim(),
        invoiceIds: invoices.map((i) => i.id),
      }),
      admin!.id,
    );
  });
}

// --- payments, oldest first across both directions --------------------------------------------
console.log("payments");
const payments = [
  ...sales.flatMap((d) => paymentRows(d.pages.history).map((r) => ({ kind: "sales" as const, doc: salesIds.get(d.id), r, date: isoDate(r[3]!) }))),
  ...purchases.flatMap((d) => paymentRows(d.pages.history).map((r) => ({ kind: "purchases" as const, doc: purchaseIds.get(d.id), r, date: isoDate(r[3]!) }))),
];
for (const p of oldestFirst(payments)) {
  if (!p.doc) continue;
  await attempt(`${p.kind} payments`, `${p.r[1]} ${p.date}`, async () => {
    // The legacy app let payments run past the bill; the excess is dropped (logged as a capped payment).
    const outstanding =
      p.kind === "sales" ? (await getInvoice(db, p.doc!)).state.outstanding : (await getPurchase(db, p.doc!)).outstanding;
    const amount = Math.min(money(p.r[6]), outstanding);
    if (amount < money(p.r[6])) appendFileSync(errorsFile, `${JSON.stringify({ kind: `${p.kind} payments`, ref: p.r[1], error: `Capped ${money(p.r[6])} to outstanding ${outstanding}` })}\n`);
    if (amount <= 0) return;
    const input = { accountId: account(p.r[2]), date: p.date, amount, method: method(p.r[4]), note: "" };
    if (p.kind === "sales") await recordPayment(db, p.doc!, salesPaymentInput.parse(input), admin!.id);
    else await payPurchase(db, p.doc!, purchasePaymentInput.parse(input), admin!.id);
  });
}

// --- expenses: NO, No Invoice, Nama, Metode, Sumber dana, Tanggal, Subtotal, Dibayar, Sisa ----
console.log("expenses");
for (const r of list("biaya").reverse()) {
  await attempt("expenses", r[1]!, async () => {
    const amount = money(r[7]) || money(r[6]);
    if (amount <= 0) throw new Error("Zero amount");
    await createExpense(
      db,
      expenseInput.parse({
        date: isoDate(r[5]!),
        accountId: account(r[4]),
        category: "Lain-lain",
        description: [r[2], r[1] && r[1] !== r[2] ? `(No. ${r[1]})` : ""].filter(Boolean).join(" ").trim(),
        amount,
        proofUrl: "",
      }),
      admin!.id,
    );
  });
}

// --- other money in ("terima uang") and out ("transfer uang"; the ledger names no destination) --
console.log("other cash entries");
for (const r of jurnal.filter((r) => r[2] === "terima uang" || r[2] === "transfer uang").reverse()) {
  await attempt("cash entries", `${r[2]} ${r[4]}`, async () => {
    const out = money(r[5]);
    const inn = money(r[6]);
    await createCashEntry(
      db,
      cashEntryInput.parse({
        accountId: account(r[3]),
        date: isoDate(r[4]!),
        direction: inn > 0 ? "in" : "out",
        amount: inn > 0 ? inn : out,
        note: r[2] === "terima uang" ? "Terima uang (aplikasi lama)" : "Transfer uang (aplikasi lama)",
      }),
      admin!.id,
    );
  });
}

// --- cashier receipts -------------------------------------------------------------------------
console.log("cashier receipts");
// Legacy receipt numbers repeat now and then; a repeat gets two extra digits so both receipts are kept.
const usedNumbers = new Set<string>();
const uniquePosNumber = (number: string) => {
  let candidate = number;
  for (let n = 1; usedNumbers.has(candidate); n++) candidate = `${number}${String(n).padStart(2, "0")}`;
  usedNumbers.add(candidate);
  return candidate;
};
/** Which account each receipt's money went to, from the ledger's "kasir" rows. */
const posAccount = new Map(jurnal.filter((r) => r[2] === "kasir" && r[1]).map((r) => [r[1]!.trim(), normName(r[3] ?? "")]));
const posMethod = (accountName: string) => (accountName === "KAS" ? "cash" : accountName === "QR" ? "qris" : "transfer");
const receipts = oldestFirst(details("kasir").map((d) => ({ ...d, date: isoDate(d.row[2]!) })));
for (const d of receipts) {
  await attempt("pos", d.row[1]!, async () => {
    const rows = d.pages.receipt!.rows;
    const lines = [];
    for (const l of receiptLines(rows)) {
      const p = await product(l.name, l.unitPrice);
      lines.push({ productId: p.id, note: p.note, qty: l.qty, unitPrice: l.unitPrice, discountAmount: Math.max(0, l.qty * l.unitPrice - l.lineTotal) });
    }
    const discount = receiptAmount(rows, "Diskon");
    const total = receiptAmount(rows, "Total Tagihan");
    await recordSale(
      db,
      posSaleInput.parse({
        id: uuidv7(),
        number: uniquePosNumber(posNumber(d.row[1]!)),
        soldAt: `${d.date}T12:00:00+07:00`,
        lines,
        discount: { kind: discount > 0 ? "amount" : "none", value: discount },
        method: posMethod(posAccount.get(d.row[1]!.trim()) ?? "KAS"),
        accountId: account(posAccount.get(d.row[1]!.trim())),
        tendered: Math.max(total, receiptAmount(rows, "Total Dibayar")),
        total,
      }),
      adminUser,
    );
  });
}

// --- stock: one opening adjustment so each product ends at the legacy stock count -------------
console.log("stock");
const derived = new Map(
  (
    await db
      .select({ id: stockMovements.productId, qty: sql<number>`sum(${stockMovements.qty})`.mapWith(Number) })
      .from(stockMovements)
      .groupBy(stockMovements.productId)
  ).map((r) => [r.id, r.qty]),
);
for (const [id, target] of legacyStock) {
  const diff = target - (derived.get(id) ?? 0);
  if (diff === 0) continue;
  await attempt("stock", id, () =>
    adjustStock(db, id, stockAdjustmentInput.parse({ qty: diff, note: "Penyesuaian migrasi: samakan dengan stok aplikasi lama" }), admin!.id),
  );
}

const [{ n }] = (await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(products)) as [{ n: number }];
console.table(counts);
console.log(`${n} products. Errors: ${errorsFile}`);
await database.close();
