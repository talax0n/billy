import {
  approvalKinds,
  approvalMethods,
  approvalStatuses,
  auditSources,
  discountKinds,
  opnameStatuses,
  quotationStatuses,
  roles,
  uuidv7,
  type Rupiah,
} from "@billy/core";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Column names are snake_case via `casing: "snake_case"` in createDb and drizzle.config.ts.

const id = () => uuid().primaryKey().$defaultFn(uuidv7);
const money = () => bigint({ mode: "number" }).$type<Rupiah>();
const businessDate = () => date({ mode: "string" });
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const userRef = () => uuid().references(() => users.id);
const voidColumns = () => ({
  voidedAt: timestamp({ withTimezone: true }),
  voidedBy: userRef(),
  voidReason: text(),
});

export const userRole = pgEnum("user_role", roles);
export const discountKind = pgEnum("discount_kind", discountKinds);
export const contactKind = pgEnum("contact_kind", ["customer", "supplier", "employee", "other"]);
export const accountKind = pgEnum("account_kind", ["cash", "bank", "ewallet"]);
export const cashDirection = pgEnum("cash_direction", ["in", "out"]);
export const cashCategory = pgEnum("cash_category", [
  "sale",
  "purchase",
  "expense",
  "transfer",
  "other_in",
  "other_out",
  "reversal",
]);
export const cashSourceType = pgEnum("cash_source_type", [
  "sales_payment",
  "purchase_payment",
  "pos_sale",
  "expense",
  "transfer",
  "manual",
]);
export const stockReason = pgEnum("stock_reason", ["purchase", "sale", "pos", "adjustment", "reversal"]);
export const stockSourceType = pgEnum("stock_source_type", ["sales_invoice", "purchase_invoice", "pos_sale", "stock_opname"]);
export const paymentDirection = pgEnum("payment_direction", ["receivable", "payable"]);
export const paymentMethod = pgEnum("payment_method", ["cash", "transfer", "qris", "giro"]);
export const posMethod = pgEnum("pos_method", ["cash", "qris", "transfer"]);
export const auditSource = pgEnum("audit_source", auditSources);
export const approvalKind = pgEnum("approval_kind", approvalKinds);
export const approvalStatus = pgEnum("approval_status", approvalStatuses);
export const approvalMethod = pgEnum("approval_method", approvalMethods);
export const posDraftStatus = pgEnum("pos_draft_status", ["open", "paid", "cancelled"]);
export const quotationStatus = pgEnum("quotation_status", quotationStatuses);
export const opnameStatus = pgEnum("opname_status", opnameStatuses);

/** A document line kept as jsonb on a document that moves no stock (nota sementara, penawaran). */
export interface DocumentLine {
  productId: string;
  qty: number;
  unitPrice: Rupiah;
  discountAmount: Rupiah;
  note: string;
}

export const users = pgTable("users", {
  id: id(),
  username: text().notNull().unique(),
  name: text().notNull(),
  passwordHash: text().notNull(),
  role: userRole().notNull(),
  active: boolean().notNull().default(true),
  /** Admins only: the 6-digit PIN that approves a kasir's action, hashed like a password. Never sent to a client. */
  approvalPinHash: text(),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text().notNull().unique(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId)],
);

export const settings = pgTable(
  "settings",
  {
    id: integer().primaryKey().default(1),
    shopName: text().notNull().default(""),
    address: text().notNull().default(""),
    phone: text().notNull().default(""),
    whatsapp: text().notNull().default(""),
    invoiceBankText: text().notNull().default(""),
    invoiceSigner: text().notNull().default(""),
    receiptFooter: text().notNull().default(""),
    posDeviceCode: text().notNull().default("K1"),
    /** Every non-admin: line and document discounts combined, basis points of the gross. */
    kasirMaxDiscountBp: integer().notNull().default(500),
    allowBelowCost: boolean().notNull().default(false),
    /** Watchdog: a closed shift whose cash difference, either way, reaches this is flagged. */
    cashDifferenceThreshold: money().notNull().default(10_000 as Rupiah),
    /** Watchdog: opening hours, Asia/Jakarta wall-clock time. */
    openTime: time().notNull().default("07:00"),
    closeTime: time().notNull().default("17:00"),
  },
  (t) => [check("settings_single_row", sql`${t.id} = 1`)],
);

export const categories = pgTable("categories", {
  id: id(),
  name: text().notNull().unique(),
  description: text().notNull().default(""),
});

export const products = pgTable(
  "products",
  {
    id: id(),
    code: text().unique(),
    barcode: text().unique(),
    name: text().notNull(),
    variant: text().notNull().default(""),
    unit: text().notNull(),
    categoryId: uuid().references(() => categories.id),
    sellPrice: money().notNull().default(0 as Rupiah),
    costPrice: money().notNull().default(0 as Rupiah),
    minStock: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index().on(t.categoryId),
    check("products_prices_non_negative", sql`${t.sellPrice} >= 0 and ${t.costPrice} >= 0`),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    code: text().notNull().unique(),
    name: text().notNull(),
    kind: contactKind().notNull(),
    phone: text().notNull().default(""),
    email: text().notNull().default(""),
    address: text().notNull().default(""),
    taxId: text().notNull().default(""),
    paymentTermsDays: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index().on(t.kind)],
);

export const accounts = pgTable("accounts", {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  kind: accountKind().notNull(),
  active: boolean().notNull().default(true),
  createdAt: createdAt(),
});

export const cashEntries = pgTable(
  "cash_entries",
  {
    id: id(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    date: businessDate().notNull(),
    direction: cashDirection().notNull(),
    amount: money().notNull(),
    category: cashCategory().notNull(),
    sourceType: cashSourceType().notNull(),
    /** Null only for manual entries. */
    sourceId: uuid(),
    note: text().notNull().default(""),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.accountId, t.date),
    index().on(t.sourceType, t.sourceId),
    check("cash_entries_amount_positive", sql`${t.amount} > 0`),
  ],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: id(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    date: businessDate().notNull(),
    qty: integer().notNull(),
    reason: stockReason().notNull(),
    unitCost: money().notNull(),
    /** Null for adjustments, which have no source document. */
    sourceType: stockSourceType(),
    sourceId: uuid(),
    note: text().notNull().default(""),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.productId, t.date),
    index().on(t.sourceType, t.sourceId),
    check("stock_movements_qty_non_zero", sql`${t.qty} <> 0`),
  ],
);

const documentDiscount = () => ({
  discountKind: discountKind().notNull().default("none"),
  /** Basis points for percent, rupiah for amount. See `Discount` in @billy/core. */
  discountValue: bigint({ mode: "number" }).notNull().default(0),
  discountAmount: money().notNull(),
});

export const salesInvoices = pgTable(
  "sales_invoices",
  {
    id: id(),
    number: text().notNull().unique(),
    customerId: uuid()
      .notNull()
      .references(() => contacts.id),
    date: businessDate().notNull(),
    dueDate: businessDate().notNull(),
    termsDays: integer().notNull().default(0),
    subtotal: money().notNull(),
    ...documentDiscount(),
    total: money().notNull(),
    note: text().notNull().default(""),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
    ...voidColumns(),
  },
  (t) => [index().on(t.customerId), index().on(t.date)],
);

export const salesLines = pgTable(
  "sales_lines",
  {
    id: id(),
    invoiceId: uuid()
      .notNull()
      .references(() => salesInvoices.id),
    position: integer().notNull(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    note: text().notNull().default(""),
    qty: integer().notNull(),
    unitPrice: money().notNull(),
    discountAmount: money().notNull().default(0 as Rupiah),
    lineTotal: money().notNull(),
    unitCost: money().notNull(),
  },
  (t) => [unique().on(t.invoiceId, t.position), check("sales_lines_qty_positive", sql`${t.qty} > 0`)],
);

export const purchaseInvoices = pgTable(
  "purchase_invoices",
  {
    id: id(),
    number: text().notNull().unique(),
    supplierInvoiceNumber: text().notNull().default(""),
    supplierId: uuid()
      .notNull()
      .references(() => contacts.id),
    date: businessDate().notNull(),
    dueDate: businessDate().notNull(),
    termsDays: integer().notNull().default(0),
    subtotal: money().notNull(),
    ...documentDiscount(),
    taxRateBp: integer().notNull().default(0),
    taxAmount: money().notNull().default(0 as Rupiah),
    total: money().notNull(),
    note: text().notNull().default(""),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
    ...voidColumns(),
  },
  (t) => [index().on(t.supplierId), index().on(t.date)],
);

export const purchaseLines = pgTable(
  "purchase_lines",
  {
    id: id(),
    invoiceId: uuid()
      .notNull()
      .references(() => purchaseInvoices.id),
    position: integer().notNull(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    note: text().notNull().default(""),
    qty: integer().notNull(),
    unitCost: money().notNull(),
    discountAmount: money().notNull().default(0 as Rupiah),
    lineTotal: money().notNull(),
  },
  (t) => [unique().on(t.invoiceId, t.position), check("purchase_lines_qty_positive", sql`${t.qty} > 0`)],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    direction: paymentDirection().notNull(),
    salesInvoiceId: uuid().references(() => salesInvoices.id),
    purchaseInvoiceId: uuid().references(() => purchaseInvoices.id),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    date: businessDate().notNull(),
    amount: money().notNull(),
    method: paymentMethod().notNull(),
    proofUrl: text(),
    note: text().notNull().default(""),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
    ...voidColumns(),
  },
  (t) => [
    index().on(t.salesInvoiceId),
    index().on(t.purchaseInvoiceId),
    check("payments_amount_positive", sql`${t.amount} > 0`),
    check(
      "payments_one_invoice",
      sql`(${t.direction} = 'receivable' and ${t.salesInvoiceId} is not null and ${t.purchaseInvoiceId} is null)
       or (${t.direction} = 'payable' and ${t.purchaseInvoiceId} is not null and ${t.salesInvoiceId} is null)`,
    ),
  ],
);

export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    number: text().notNull().unique(),
    date: businessDate().notNull(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    category: text().notNull(),
    description: text().notNull().default(""),
    amount: money().notNull(),
    proofUrl: text(),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
    ...voidColumns(),
  },
  (t) => [index().on(t.date), check("expenses_amount_positive", sql`${t.amount} > 0`)],
);

export const transfers = pgTable(
  "transfers",
  {
    id: id(),
    date: businessDate().notNull(),
    fromAccountId: uuid()
      .notNull()
      .references(() => accounts.id),
    toAccountId: uuid()
      .notNull()
      .references(() => accounts.id),
    amount: money().notNull(),
    note: text().notNull().default(""),
    proofUrl: text(),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
    ...voidColumns(),
  },
  (t) => [
    index().on(t.date),
    check("transfers_amount_positive", sql`${t.amount} > 0`),
    check("transfers_distinct_accounts", sql`${t.fromAccountId} <> ${t.toAccountId}`),
  ],
);

export const invoiceBundles = pgTable(
  "invoice_bundles",
  {
    id: id(),
    number: text().notNull().unique(),
    customerId: uuid()
      .notNull()
      .references(() => contacts.id),
    date: businessDate().notNull(),
    note: text().notNull().default(""),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
    voidedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.customerId)],
);

export const bundleInvoices = pgTable(
  "bundle_invoices",
  {
    bundleId: uuid()
      .notNull()
      .references(() => invoiceBundles.id),
    invoiceId: uuid()
      .notNull()
      .references(() => salesInvoices.id),
  },
  (t) => [primaryKey({ columns: [t.bundleId, t.invoiceId] }), index().on(t.invoiceId)],
);

export const posSales = pgTable(
  "pos_sales",
  {
    /** Generated by the client so an offline retry is idempotent. */
    id: uuid().primaryKey(),
    number: text().notNull().unique(),
    deviceCode: text().notNull(),
    soldAt: timestamp({ withTimezone: true }).notNull(),
    date: businessDate().notNull(),
    cashierId: userRef().notNull(),
    customerId: uuid().references(() => contacts.id),
    subtotal: money().notNull(),
    ...documentDiscount(),
    total: money().notNull(),
    method: posMethod().notNull(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    tendered: money().notNull(),
    change: money().notNull(),
    /** Null only for sales made before shifts existed. */
    shiftId: uuid().references(() => cashShifts.id),
    /** Set on a revisi: the nota it replaced, which is voided in the same transaction. */
    revisionOf: uuid().references((): AnyPgColumn => posSales.id),
    /** Prints so far; the receipt printed at checkout is the first. Every later one says SALINAN. */
    printCount: integer().notNull().default(1),
    /** Server receive time. */
    createdAt: createdAt(),
    ...voidColumns(),
  },
  (t) => [index().on(t.date), index().on(t.cashierId), index().on(t.shiftId), uniqueIndex().on(t.revisionOf)],
);

/**
 * Nota sementara: an unpaid Kasir cart kept on the server, shared by every device. It moves no
 * stock and no money. It is never deleted: it ends `paid` (linked to its POS sale) or `cancelled`.
 */
export const posDrafts = pgTable(
  "pos_drafts",
  {
    id: id(),
    number: text().notNull().unique(),
    date: businessDate().notNull(),
    createdBy: userRef().notNull(),
    customerId: uuid().references(() => contacts.id),
    lines: jsonb().$type<DocumentLine[]>().notNull(),
    subtotal: money().notNull(),
    ...documentDiscount(),
    total: money().notNull(),
    status: posDraftStatus().notNull().default("open"),
    printCount: integer().notNull().default(0),
    saleId: uuid()
      .unique()
      .references(() => posSales.id),
    createdAt: createdAt(),
    updatedAt: createdAt(),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelledBy: userRef(),
    cancelReason: text(),
  },
  (t) => [index().on(t.status)],
);

/**
 * One cashier's session at one Kasir device, from the opening float to the blind cash count.
 * `id` and `opened_at` come from the device, so a shift opened offline syncs idempotently.
 * The close fields are set together when the shift closes; `expected_cash` is computed by the
 * server and never sent to a kasir.
 */
export const cashShifts = pgTable(
  "cash_shifts",
  {
    id: uuid().primaryKey(),
    cashierId: userRef().notNull(),
    deviceCode: text().notNull(),
    /** The cash drawer: the account the Kasir's cash sales pay into. */
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    openedAt: timestamp({ withTimezone: true }).notNull(),
    openingFloat: money().notNull(),
    closedAt: timestamp({ withTimezone: true }),
    countedCash: money(),
    expectedCash: money(),
    /** Counted minus expected: negative when cash is missing. */
    difference: money(),
    closeNote: text(),
  },
  (t) => [
    index().on(t.openedAt),
    uniqueIndex("cash_shifts_one_open").on(t.cashierId, t.deviceCode).where(sql`${t.closedAt} is null`),
    check("cash_shifts_float_non_negative", sql`${t.openingFloat} >= 0`),
  ],
);

/**
 * Stok opname: a count of all active products, or one category's. Only entered lines count.
 * A draft is a shared workspace; posting (admin only) takes each line's system stock at that
 * moment, writes an `adjustment` movement per difference, and freezes the opname.
 */
export const stockOpnames = pgTable(
  "stock_opnames",
  {
    id: id(),
    number: text().notNull().unique(),
    date: businessDate().notNull(),
    /** Null: all active products. */
    categoryId: uuid().references(() => categories.id),
    note: text().notNull().default(""),
    status: opnameStatus().notNull().default("draft"),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
    postedBy: userRef(),
    postedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.postedAt)],
);

export const stockOpnameLines = pgTable(
  "stock_opname_lines",
  {
    opnameId: uuid()
      .notNull()
      .references(() => stockOpnames.id),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    countedQty: integer().notNull(),
    /** Set at posting: the stock then and the cost price the difference is valued at. */
    systemQty: integer(),
    unitCost: money(),
  },
  (t) => [primaryKey({ columns: [t.opnameId, t.productId] }), check("stock_opname_lines_counted_non_negative", sql`${t.countedQty} >= 0`)],
);

/** Penawaran harga: moves no stock and no money, and is in no total. Converts to one sales invoice. */
export const quotations = pgTable(
  "quotations",
  {
    id: id(),
    number: text().notNull().unique(),
    customerId: uuid()
      .notNull()
      .references(() => contacts.id),
    date: businessDate().notNull(),
    validUntil: businessDate().notNull(),
    lines: jsonb().$type<DocumentLine[]>().notNull(),
    subtotal: money().notNull(),
    ...documentDiscount(),
    total: money().notNull(),
    note: text().notNull().default(""),
    status: quotationStatus().notNull().default("draft"),
    invoiceId: uuid()
      .unique()
      .references(() => salesInvoices.id),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.date), index().on(t.customerId)],
);

export const posLines = pgTable(
  "pos_lines",
  {
    id: id(),
    saleId: uuid()
      .notNull()
      .references(() => posSales.id),
    position: integer().notNull(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    note: text().notNull().default(""),
    qty: integer().notNull(),
    unitPrice: money().notNull(),
    discountAmount: money().notNull().default(0 as Rupiah),
    lineTotal: money().notNull(),
    unitCost: money().notNull(),
  },
  (t) => [unique().on(t.saleId, t.position), check("pos_lines_qty_positive", sql`${t.qty} > 0`)],
);

export const documentSequences = pgTable(
  "document_sequences",
  {
    prefix: text().notNull(),
    /** `YYMMDD` of the business date. */
    period: text().notNull(),
    lastValue: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.prefix, t.period] })],
);

/**
 * An admin's yes to one exact action. `subject` is what was approved (sale, amount, discount,
 * lines); spending it compares that subject with the action's own, so it fits nothing else.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    kind: approvalKind().notNull(),
    status: approvalStatus().notNull(),
    method: approvalMethod().notNull(),
    requestedBy: userRef().notNull(),
    deviceCode: text(),
    subject: jsonb().notNull(),
    /** One readable line for the admin's bell, e.g. "Diskon 8% · K1-261113-0004 · Rp 380.000". */
    summary: text().notNull(),
    decidedBy: userRef(),
    decidedAt: timestamp({ withTimezone: true }),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [index().on(t.status, t.createdAt), index().on(t.requestedBy)],
);

/** Append-only: a trigger in the migration rejects UPDATE, DELETE and TRUNCATE. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Null only for a failed login with an unknown username. */
    actorId: userRef(),
    actorRole: userRole(),
    source: auditSource().notNull(),
    deviceCode: text(),
    /** A key of `auditActions` in @billy/core. */
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    summary: text().notNull(),
    before: jsonb(),
    after: jsonb(),
    reason: text(),
    approvalId: uuid().references(() => approvals.id),
  },
  (t) => [index().on(t.at), index().on(t.actorId, t.action, t.at)],
);
