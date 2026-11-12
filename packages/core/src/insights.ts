import { needsAttention, stockLevel } from "./stock.ts";
import { addDays } from "./dates.ts";
import { rupiah, type Rupiah } from "./money.ts";

export interface DateWindow {
  from: string;
  to: string;
}
export type InsightPeriod = "month" | "last-month" | "30-days" | "custom";
export function periodWindow(
  period: InsightPeriod,
  today: string,
  custom?: DateWindow,
): DateWindow {
  if (period === "custom") {
    if (!custom || custom.from > custom.to)
      throw new RangeError("Rentang tanggal tidak valid");
    return custom;
  }
  if (period === "30-days") return { from: addDays(today, -29), to: today };
  const first = `${today.slice(0, 7)}-01`;
  if (period === "month") return { from: first, to: today };
  const last = addDays(first, -1);
  return { from: `${last.slice(0, 7)}-01`, to: last };
}
export function previousWindow(window: DateWindow): DateWindow {
  const days =
    Math.round((Date.parse(window.to) - Date.parse(window.from)) / 86400000) +
    1;
  return { from: addDays(window.from, -days), to: addDays(window.from, -1) };
}
export function delta(current: number, previous: number) {
  return {
    amount: rupiah(current - previous),
    percent:
      previous === 0
        ? current === 0
          ? 0
          : null
        : Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10,
  };
}
export function weekStart(date: string) {
  return addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
}
/** A sales or purchase invoice with money still owed at some date. */
export interface OpenInvoice {
  id: string;
  number: string;
  contactId: string;
  contactName: string;
  dueDate: string;
  total: Rupiah;
  outstanding: Rupiah;
}
export interface OpenInvoices {
  receivables: OpenInvoice[];
  payables: OpenInvoice[];
}
/** Sums over one date window; cash flow excludes transfers. */
export interface PeriodTotals {
  invoiceSales: Rupiah;
  posSales: Rupiah;
  profit: Rupiah;
  incoming: Rupiah;
  outgoing: Rupiah;
}
export interface AccountBalance {
  id: string;
  name: string;
  kind: "cash" | "bank" | "ewallet";
  balance: Rupiah;
  weeklyChange: Rupiah;
}
export interface ProductStock {
  id: string;
  name: string;
  stock: number;
  minStock: number;
}
const sum = <T>(rows: readonly T[], value: (row: T) => number) =>
  rupiah(rows.reduce((n, row) => n + value(row), 0));
const outstanding = (r: OpenInvoice) => r.outstanding;
const payablesDueBy = (at: string) => addDays(at, 7);
export function kpis(totals: PeriodTotals, open: OpenInvoices, at: string) {
  const sales = rupiah(totals.invoiceSales + totals.posSales);
  return {
    ...totals,
    sales,
    margin: sales === 0 ? 0 : Math.round((totals.profit / sales) * 1000) / 10,
    net: rupiah(totals.incoming - totals.outgoing),
    receivables: sum(open.receivables, outstanding),
    overdue: sum(
      open.receivables.filter((r) => r.dueDate < at),
      outstanding,
    ),
    duePayables: sum(
      open.payables.filter((r) => r.dueDate <= payablesDueBy(at)),
      outstanding,
    ),
  };
}
/** Fills the weeks without cash movement with real zeros, oldest week first. */
export function weeklyCashFlow(
  totals: { from: string; incoming: Rupiah; outgoing: Rupiah }[],
  today: string,
  weeks: number,
) {
  const start = weekStart(today);
  return Array.from({ length: weeks }, (_, i) => {
    const from = addDays(start, (i - weeks + 1) * 7);
    const end = addDays(from, 6);
    const week = totals.find((t) => t.from === from);
    const incoming = week?.incoming ?? rupiah(0);
    const outgoing = week?.outgoing ?? rupiah(0);
    return {
      from,
      to: end > today ? today : end,
      incoming,
      outgoing,
      net: rupiah(incoming - outgoing),
    };
  });
}
export const CASH_DEPOSIT_THRESHOLD = rupiah(10_000_000);
type ActionBase = { id: string; name: string };
export type ActionItem =
  | (ActionBase & {
      kind: "receivable";
      customerId: string;
      amount: Rupiah;
      count: number;
      dueDate: string;
    })
  | (ActionBase & {
      kind: "payable";
      invoiceId: string;
      status: "partial" | "unpaid";
      amount: Rupiah;
      dueDate: string;
    })
  | (ActionBase & {
      kind: "negative-stock" | "low-stock";
      productId: string;
      stock: number;
      minStock: number;
    })
  | (ActionBase & { kind: "deposit"; accountId: string; amount: Rupiah });
export const actionRegistry = {
  "negative-stock": {
    title: "Periksa stok negatif",
    priority: 0,
    target: "/produk",
  },
  receivable: { title: "Tagih piutang", priority: 1, target: "/piutang" },
  payable: { title: "Bayar pemasok", priority: 2, target: "/hutang" },
  "low-stock": { title: "Pesan stok", priority: 3, target: "/pembelian" },
  deposit: { title: "Setor kas toko", priority: 4, target: "/kas-bank" },
} as const;
export function rankActions(items: ActionItem[]): ActionItem[] {
  return [...items].sort(
    (a, b) =>
      actionRegistry[a.kind].priority - actionRegistry[b.kind].priority ||
      ("dueDate" in a && "dueDate" in b
        ? a.dueDate.localeCompare(b.dueDate)
        : 0) ||
      ("amount" in a && "amount" in b ? b.amount - a.amount : 0) ||
      a.id.localeCompare(b.id),
  );
}
export function actionItems(
  input: OpenInvoices & { products: ProductStock[]; balances: AccountBalance[] },
  today: string,
): ActionItem[] {
  const items: ActionItem[] = [];
  const customers = new Map<
    string,
    Extract<ActionItem, { kind: "receivable" }>
  >();
  for (const invoice of input.receivables) {
    if (invoice.dueDate >= today) continue;
    const previous = customers.get(invoice.contactId);
    customers.set(invoice.contactId, {
      kind: "receivable",
      id: `receivable:${invoice.contactId}`,
      customerId: invoice.contactId,
      name: invoice.contactName,
      amount: rupiah(invoice.outstanding + (previous?.amount ?? 0)),
      count: (previous?.count ?? 0) + 1,
      dueDate:
        previous && previous.dueDate < invoice.dueDate
          ? previous.dueDate
          : invoice.dueDate,
    });
  }
  items.push(...customers.values());
  for (const invoice of input.payables)
    if (invoice.dueDate <= payablesDueBy(today))
      items.push({
        kind: "payable",
        id: `payable:${invoice.id}`,
        invoiceId: invoice.id,
        status: invoice.outstanding < invoice.total ? "partial" : "unpaid",
        name: `${invoice.contactName} · ${invoice.number}`,
        amount: invoice.outstanding,
        dueDate: invoice.dueDate,
      });
  for (const p of input.products)
    if (needsAttention(stockLevel(p.stock, p.minStock)))
      items.push({
        kind: p.stock < 0 ? "negative-stock" : "low-stock",
        id: `stock:${p.id}`,
        productId: p.id,
        name: p.name,
        stock: p.stock,
        minStock: p.minStock,
      });
  for (const a of input.balances)
    if (a.kind === "cash" && a.balance > CASH_DEPOSIT_THRESHOLD)
      items.push({
        kind: "deposit",
        id: `deposit:${a.id}`,
        accountId: a.id,
        name: a.name,
        amount: a.balance,
      });
  return rankActions(items);
}
