/**
 * Second pass over a database the legacy import already filled: imports the documents it skipped
 * (listed in .legacy/import-errors.jsonl) that can be kept without inventing data.
 *
 * - Cashier receipts whose printed total the app's arithmetic cannot reproduce: the legacy total
 *   stands, and the gap becomes one "Selisih impor (data lama)" line that moves no stock. Written
 *   directly, like a sale from before shifts existed (no shift), since `recordSale` refuses both.
 * - Tukar faktur bundles the import matched to the wrong invoice (legacy invoice numbers repeat):
 *   each number is resolved to the one customer every invoice in the bundle shares.
 * - Stock: the legacy count already includes the receipts, so a "Penyesuaian migrasi" per product
 *   cancels their movements and every product keeps the stock it had before this script ran.
 *
 * Idempotent: a receipt whose number exists, or a bundle whose legacy code exists, is left alone.
 *
 *   pnpm --filter @billy/api import:legacy-skipped [dataDir]   (default .data/legacy)
 *   DATABASE_URL=... pnpm --filter @billy/api import:legacy-skipped
 */
import { existsSync, readFileSync } from "node:fs";
import { formatRupiah, productInput, type Rupiah, stockAdjustmentInput, uuidv7 } from "@billy/core";
import {
  accounts,
  bundleInvoices,
  cashEntries,
  createDb,
  type Db,
  invoiceBundles,
  posLines,
  posSales,
  products,
  salesInvoices,
  stockMovements,
  users,
} from "@billy/db";
import { and, asc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { audit, systemActor } from "../lib/audit.ts";
import { costAsOf } from "../lib/cost-as-of.ts";
import { allocateDocNumber } from "../lib/doc-number.ts";
import { adjustStock, createProduct } from "../modules/products/service.ts";
import { ADJUSTMENT_NOTE, type AdjustedReceipt, adjustedReceipt, money, normName, receiptAmount, splitTint } from "./parse.ts";
import { details, errorsFile, list, numberedReceipts, oldestFirst, posAccounts, posMethod, root } from "./source.ts";

const url = process.env.DATABASE_URL;
const dataDir = process.argv[2] ?? `${root}.data/legacy`;
if (!url && !existsSync(dataDir)) throw new Error(`${dataDir} does not exist. Run import:legacy first.`);
if (!existsSync(errorsFile)) throw new Error(`${errorsFile} not found. It is written by import:legacy.`);

const skipped = readFileSync(errorsFile, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as { kind: string; ref: string });
const skippedRefs = (kind: string) => new Set(skipped.filter((e) => e.kind === kind).map((e) => e.ref));

const database = url ? await createDb({ url }) : await createDb({ dataDir });
await database.migrate();
const { db } = database;

const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).orderBy(asc(users.createdAt)).limit(1);
if (!admin) throw new Error("No admin user: this database was not filled by import:legacy.");
const system = systemActor(admin.id);

const reasons = new Map<string, number>();
const report = (reason: string) => reasons.set(reason, (reasons.get(reason) ?? 0) + 1);

// --- cashier receipts -------------------------------------------------------------------------
const productByName = new Map<string, string>();
for (const p of await db.select({ id: products.id, name: products.name }).from(products).orderBy(asc(products.createdAt))) {
  if (!productByName.has(normName(p.name))) productByName.set(normName(p.name), p.id);
}
let productsCreated = 0;
/** The main import's product match: exact name, then the name without its tint, else a new product. */
async function product(lineName: string, price: number): Promise<{ id: string; note: string }> {
  const exact = productByName.get(normName(lineName));
  if (exact) return { id: exact, note: "" };
  const { name, note } = splitTint(lineName);
  const base = productByName.get(normName(name));
  if (base) return { id: base, note };
  const p = await createProduct(
    db,
    productInput.parse({ code: null, barcode: null, name: lineName.trim(), unit: "PCS", categoryId: null, sellPrice: price, costPrice: 0, minStock: 0 }),
    system,
  );
  productsCreated++;
  productByName.set(normName(lineName), p.id);
  return { id: p.id, note: "" };
}

/** The inactive, never-stocked product every adjustment line points at (a POS line needs a product). */
const ADJUSTMENT_CODE = "LEG-SELISIH";
async function adjustmentProduct() {
  const [found] = await db.select({ id: products.id }).from(products).where(eq(products.code, ADJUSTMENT_CODE));
  if (found) return found.id;
  const created = await createProduct(
    db,
    productInput.parse({ code: ADJUSTMENT_CODE, barcode: null, name: ADJUSTMENT_NOTE, unit: "LS", categoryId: null, sellPrice: 0, costPrice: 0, minStock: 0, active: false }),
    system,
  );
  return created.id;
}

const accountByName = new Map((await db.select({ id: accounts.id, name: accounts.name }).from(accounts)).map((a) => [normName(a.name), a.id]));
const kas = accountByName.get("KAS");
if (!kas) throw new Error('No "KAS" account: this database was not filled by import:legacy.');
const posAccount = posAccounts(list("jurnal"));

const posRefs = skippedRefs("pos");
const candidates = numberedReceipts().filter((d) => posRefs.has(d.row[1]!) && d.number);
const existing = new Set(
  candidates.length
    ? (await db.select({ number: posSales.number }).from(posSales).where(inArray(posSales.number, candidates.map((d) => d.number!)))).map((r) => r.number)
    : [],
);
const pos = { imported: 0, present: 0, failed: 0, adjustment: 0, total: 0, units: 0 };
const adjustmentId = candidates.some((d) => !existing.has(d.number!)) ? await adjustmentProduct() : null;

for (const d of candidates) {
  const number = d.number!;
  if (existing.has(number)) {
    pos.present++;
    continue;
  }
  try {
    const receipt = adjustedReceipt(d.pages.receipt!.rows);
    if (receipt.lines.length === 0) throw new Error("Receipt has no item lines");
    const lines: (AdjustedReceipt["lines"][number] & { id: string; note: string })[] = [];
    for (const l of receipt.lines) lines.push({ ...l, ...(await product(l.name, l.unitPrice)) });
    const accountName = posAccount.get(d.row[1]!.trim()) ?? "KAS";
    const accountId = accountByName.get(accountName) ?? kas;
    const tendered = Math.max(receipt.total, receiptAmount(d.pages.receipt!.rows, "Total Dibayar"));
    const id = uuidv7();
    const soldAt = new Date(`${d.date}T12:00:00+07:00`);

    await db.transaction(async (tx) => {
      const costs = new Map(
        (
          await tx
            .select({ id: products.id, cost: costAsOf(d.date) })
            .from(products)
            .where(inArray(products.id, lines.map((l) => l.id)))
        ).map((p) => [p.id, p.cost]),
      );
      await tx.insert(posSales).values({
        id,
        number,
        deviceCode: number.split("-")[0]!,
        soldAt,
        date: d.date,
        cashierId: admin.id,
        subtotal: receipt.subtotal as Rupiah,
        discountKind: receipt.discount > 0 ? "amount" : "none",
        discountValue: receipt.discount,
        discountAmount: receipt.discount as Rupiah,
        total: receipt.total as Rupiah,
        method: posMethod(accountName),
        accountId,
        tendered: tendered as Rupiah,
        change: (tendered - receipt.total) as Rupiah,
        shiftId: null,
      });
      const saleLines = lines.map((l, position) => ({
        saleId: id,
        position,
        productId: l.id,
        note: l.note,
        qty: l.qty,
        unitPrice: l.unitPrice as Rupiah,
        discountAmount: l.discountAmount as Rupiah,
        lineTotal: l.appLineTotal as Rupiah,
        unitCost: costs.get(l.id) ?? (0 as Rupiah),
      }));
      // Written even at zero: the line marks the sales this script wrote (see the stock step).
      saleLines.push({
          saleId: id,
          position: lines.length,
          productId: adjustmentId!,
          note: ADJUSTMENT_NOTE,
          qty: 1,
          unitPrice: receipt.adjustment as Rupiah,
          discountAmount: 0 as Rupiah,
          lineTotal: receipt.adjustment as Rupiah,
          unitCost: 0 as Rupiah,
      });
      await tx.insert(posLines).values(saleLines);
      await tx.insert(stockMovements).values(
        lines.map((l) => ({
          productId: l.id,
          date: d.date,
          qty: -l.qty,
          reason: "pos" as const,
          unitCost: costs.get(l.id) ?? (0 as Rupiah),
          sourceType: "pos_sale" as const,
          sourceId: id,
          note: number,
          createdBy: admin.id,
        })),
      );
      if (receipt.total > 0) {
        await tx.insert(cashEntries).values({
          accountId,
          date: d.date,
          direction: "in",
          amount: receipt.total as Rupiah,
          category: "sale",
          sourceType: "pos_sale",
          sourceId: id,
          note: number,
          createdBy: admin.id,
        });
      }
      await audit(tx, system, {
        action: "pos.sale.create",
        entityId: id,
        summary: `Penjualan ${number} ${formatRupiah(receipt.total as Rupiah)} (impor data lama, ${ADJUSTMENT_NOTE.toLowerCase()} ${formatRupiah(receipt.adjustment as Rupiah)})`,
        after: { number, soldAt: soldAt.toISOString(), total: receipt.total, computedTotal: receipt.computedTotal, adjustment: receipt.adjustment, lines: saleLines.length },
        deviceCode: number.split("-")[0]!,
      });
    });
    pos.imported++;
    pos.adjustment += receipt.adjustment;
    pos.total += receipt.total;
    pos.units += lines.reduce((sum, l) => sum + l.qty, 0);
  } catch (error) {
    pos.failed++;
    report(`receipt: ${(error as Error).message}`);
  }
}

// --- stock: the legacy count already includes these sales -------------------------------------
// The main import's opening adjustment set every product to the legacy count, which already
// reflects these sales. Their movements stay for history; one adjustment per product cancels
// them. Reconciled from the database, so a rerun or a crash in between converges.
const COMPENSATION_NOTE = "Penyesuaian migrasi: struk data lama yang diimpor ulang, stok sudah termasuk";
const qtyByProduct = { id: stockMovements.productId, qty: sql<number>`sum(${stockMovements.qty})`.mapWith(Number) };
const sold = await db
  .select(qtyByProduct)
  .from(stockMovements)
  .where(
    and(
      eq(stockMovements.reason, "pos"),
      eq(stockMovements.sourceType, "pos_sale"),
      inArray(
        stockMovements.sourceId,
        db.select({ id: posLines.saleId }).from(posLines).innerJoin(products, eq(products.id, posLines.productId)).where(eq(products.code, ADJUSTMENT_CODE)),
      ),
    ),
  )
  .groupBy(stockMovements.productId);
const compensated = new Map(
  (
    await db
      .select(qtyByProduct)
      .from(stockMovements)
      .where(and(eq(stockMovements.reason, "adjustment"), eq(stockMovements.note, COMPENSATION_NOTE)))
      .groupBy(stockMovements.productId)
  ).map((r) => [r.id, r.qty]),
);
const owed = sold.map((r) => ({ productId: r.id, qty: -r.qty - (compensated.get(r.id) ?? 0) })).filter((r) => r.qty !== 0);
let compensations = 0;
for (const row of owed) {
  await adjustStock(db, row.productId, stockAdjustmentInput.parse({ qty: row.qty, note: COMPENSATION_NOTE }), system);
  compensations++;
}

// --- tukar faktur -----------------------------------------------------------------------------
type Invoice = { id: string; customerId: string; total: number; voided: boolean; bundled: boolean };
/** Every imported invoice by legacy number (the import notes each one "Legacy <number>"). */
async function invoicesByNumber(tx: Db) {
  const rows = await tx
    .select({
      id: salesInvoices.id,
      note: salesInvoices.note,
      customerId: salesInvoices.customerId,
      total: salesInvoices.total,
      voidedAt: salesInvoices.voidedAt,
      bundled: sql<boolean>`exists (select 1 from ${bundleInvoices} bi join ${invoiceBundles} ib on ib.id = bi.bundle_id where bi.invoice_id = ${salesInvoices.id} and ib.voided_at is null)`,
    })
    .from(salesInvoices)
    .where(like(salesInvoices.note, "Legacy %"));
  const byNumber = new Map<string, Invoice[]>();
  for (const r of rows) {
    const key = normName(r.note.slice("Legacy ".length));
    byNumber.set(key, [...(byNumber.get(key) ?? []), { id: r.id, customerId: r.customerId, total: r.total, voided: !!r.voidedAt, bundled: r.bundled }]);
  }
  return byNumber;
}

/**
 * The bundle's invoices: for each listed number, the invoice of the one customer every listed
 * number has an invoice for. A number listed n times takes that customer's n invoices; when the
 * customer has more, the printed amount decides. A string is why the bundle cannot be kept.
 */
function resolveBundle(rows: { number: string; amount: number }[], byNumber: Map<string, Invoice[]>): { customerId: string; invoiceIds: string[] } | string {
  if (rows.length === 0) return "lists no invoices";
  const options = rows.map((r) => byNumber.get(normName(r.number)) ?? []);
  if (options.some((o) => o.length === 0)) return "an invoice it lists was not imported";
  const shared = [...new Set(options[0]!.map((i) => i.customerId))].filter((c) => options.every((o) => o.some((i) => i.customerId === c)));
  if (shared.length !== 1) return shared.length === 0 ? "its invoices belong to different customers" : "two customers fit every invoice";
  const customerId = shared[0]!;
  const invoices: Invoice[] = [];
  for (const number of new Set(rows.map((r) => normName(r.number)))) {
    const wanted = rows.filter((r) => normName(r.number) === number);
    let pool = byNumber.get(number)!.filter((i) => i.customerId === customerId);
    if (pool.length > wanted.length) pool = pool.filter((i) => wanted.some((w) => w.amount === i.total));
    if (pool.length !== wanted.length) return "an invoice number matches more than one invoice of the customer";
    invoices.push(...pool);
  }
  if (invoices.some((i) => i.voided)) return "an invoice it lists is voided";
  if (invoices.some((i) => i.bundled)) return "an invoice it lists is already in another bundle";
  return { customerId, invoiceIds: invoices.map((i) => i.id) };
}

const bundleRefs = skippedRefs("bundles");
const bundle = { imported: 0, present: 0, failed: 0 };
const legacyBundles = oldestFirst(
  details("tukar_faktur")
    .filter((d) => bundleRefs.has(d.pages.detail!.inputs.kode_tukar_faktur ?? d.id))
    .map((d) => ({ ...d, date: /(\d{4}-\d{2}-\d{2})/.exec(d.pages.detail!.inputs.kode_tukar_faktur ?? "")?.[1] ?? "2023-01-01" })),
);
for (const d of legacyBundles) {
  const h = d.pages.detail!.inputs;
  const note = `Legacy ${h.kode_tukar_faktur ?? ""}`.trim();
  const [found] = await db.select({ id: invoiceBundles.id }).from(invoiceBundles).where(and(eq(invoiceBundles.note, note), isNull(invoiceBundles.voidedAt)));
  if (found) {
    bundle.present++;
    continue;
  }
  const rows = d.pages.detail!.rows.filter((r) => /^\d+$/.test(r[0] ?? "")).map((r) => ({ number: r[1]!, amount: money(r[2]) }));
  const resolved = await db.transaction(async (tx) => {
    const result = resolveBundle(rows, await invoicesByNumber(tx));
    if (typeof result === "string") return result;
    const number = await allocateDocNumber(tx, "TF", d.date);
    const [created] = await tx
      .insert(invoiceBundles)
      .values({ number, customerId: result.customerId, date: d.date, note, createdBy: admin.id })
      .returning({ id: invoiceBundles.id });
    await tx.insert(bundleInvoices).values(result.invoiceIds.map((invoiceId) => ({ bundleId: created!.id, invoiceId })));
    await audit(tx, system, {
      action: "invoice_bundle.create",
      entityId: created!.id,
      summary: `Tukar faktur ${number} (${result.invoiceIds.length} faktur, impor data lama)`,
      after: { number, customerId: result.customerId, date: d.date, invoiceIds: result.invoiceIds },
    });
    return null;
  });
  if (resolved === null) bundle.imported++;
  else {
    bundle.failed++;
    report(`bundle: ${resolved}`);
  }
}

console.log("Cashier receipts skipped by import:legacy");
console.table({
  imported: pos.imported,
  "already present": pos.present,
  failed: pos.failed,
  "sum of legacy totals": pos.total,
  "sum of Selisih impor lines": pos.adjustment,
  "units of stock moved": pos.units,
  "products created": productsCreated,
  "stock adjustments added": compensations,
});
console.log("Tukar faktur skipped by import:legacy");
console.table(bundle);
if (reasons.size) {
  console.log("Not imported, by reason");
  console.table(Object.fromEntries(reasons));
}
await database.close();
