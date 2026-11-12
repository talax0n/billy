import { discountKinds, roles, uuidv7, type Rupiah } from "@billy/core";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
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
export const stockSourceType = pgEnum("stock_source_type", ["sales_invoice", "purchase_invoice", "pos_sale"]);
export const paymentDirection = pgEnum("payment_direction", ["receivable", "payable"]);
export const paymentMethod = pgEnum("payment_method", ["cash", "transfer", "qris", "giro"]);
export const posMethod = pgEnum("pos_method", ["cash", "qris", "transfer"]);

export const users = pgTable("users", {
  id: id(),
  username: text().notNull().unique(),
  name: text().notNull(),
  passwordHash: text().notNull(),
  role: userRole().notNull(),
  active: boolean().notNull().default(true),
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
    /** Server receive time. */
    createdAt: createdAt(),
    ...voidColumns(),
  },
  (t) => [index().on(t.date), index().on(t.cashierId)],
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
