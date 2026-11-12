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
export const inWindow = (date: string, window: DateWindow) =>
  date >= window.from && date <= window.to;
export function weekStart(date: string) {
  return addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
}
export interface InsightInvoice {
  id: string;
  number: string;
  contactId: string;
  contactName: string;
  date: string;
  dueDate: string;
  total: Rupiah;
  profit: Rupiah;
  voidedDate: string | null;
}
export interface InsightPayment {
  invoiceId: string;
  date: string;
  amount: Rupiah;
  voidedDate: string | null;
}
export interface InsightSale {
  id: string;
  number: string;
  date: string;
  total: Rupiah;
  profit: Rupiah;
  voidedDate: string | null;
}
export interface InsightCash {
  id: string;
  accountId: string;
  date: string;
  direction: "in" | "out";
  amount: Rupiah;
  sourceType: string;
  note: string;
}
export interface InsightAccount {
  id: string;
  name: string;
  kind: "cash" | "bank" | "ewallet";
}
export interface InsightData {
  invoices: InsightInvoice[];
  purchases: InsightInvoice[];
  pos: InsightSale[];
  payments: InsightPayment[];
  cash: InsightCash[];
  accounts: InsightAccount[];
  products: { id: string; name: string; stock: number; minStock: number }[];
}
const sum = <T>(rows: readonly T[], value: (row: T) => number) =>
  rupiah(rows.reduce((n, row) => n + value(row), 0));
const activeAt = (
  row: { date: string; voidedDate: string | null },
  date: string,
) => row.date <= date && (!row.voidedDate || row.voidedDate > date);
export function outstanding(
  invoice: InsightInvoice,
  payments: InsightPayment[],
  at: string,
): Rupiah {
  if (!activeAt(invoice, at)) return rupiah(0);
  return rupiah(
    Math.max(
      0,
      invoice.total -
        sum(
          payments.filter((p) => p.invoiceId === invoice.id && activeAt(p, at)),
          (p) => p.amount,
        ),
    ),
  );
}
export function cashFlow(
  cash: InsightCash[],
  window: DateWindow,
  account?: string,
) {
  const rows = cash.filter(
    (r) =>
      inWindow(r.date, window) &&
      r.sourceType !== "transfer" &&
      (!account || r.accountId === account),
  );
  const incoming = sum(
    rows.filter((r) => r.direction === "in"),
    (r) => r.amount,
  );
  const outgoing = sum(
    rows.filter((r) => r.direction === "out"),
    (r) => r.amount,
  );
  return { incoming, outgoing, net: rupiah(incoming - outgoing) };
}
export function kpis(data: InsightData, window: DateWindow, account?: string) {
  const invoices = data.invoices.filter(
    (r) => !r.voidedDate && inWindow(r.date, window),
  );
  const pos = data.pos.filter((r) => !r.voidedDate && inWindow(r.date, window));
  const invoiceSales = sum(invoices, (r) => r.total);
  const posSales = sum(pos, (r) => r.total);
  const sales = rupiah(invoiceSales + posSales);
  const profit = rupiah(
    sum(invoices, (r) => r.profit) + sum(pos, (r) => r.profit),
  );
  const receivables = sum(data.invoices, (r) =>
    outstanding(r, data.payments, window.to),
  );
  const overdue = sum(
    data.invoices.filter((r) => r.dueDate < window.to),
    (r) => outstanding(r, data.payments, window.to),
  );
  const duePayables = sum(
    data.purchases.filter((r) => r.dueDate <= addDays(window.to, 7)),
    (r) => outstanding(r, data.payments, window.to),
  );
  return {
    sales,
    invoiceSales,
    posSales,
    profit,
    margin: sales === 0 ? 0 : Math.round((profit / sales) * 1000) / 10,
    ...cashFlow(data.cash, window, account),
    receivables,
    overdue,
    duePayables,
  };
}
export function accountBalances(
  data: Pick<InsightData, "accounts" | "cash">,
  today: string,
) {
  return data.accounts
    .map((account) => {
      const rows = data.cash.filter(
        (r) => r.accountId === account.id && r.date <= today,
      );
      const signed = (r: InsightCash) =>
        r.direction === "in" ? r.amount : -r.amount;
      return {
        ...account,
        balance: sum(rows, signed),
        weeklyChange: sum(
          rows.filter((r) => r.date >= weekStart(today)),
          signed,
        ),
      };
    })
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
}
export function weeklyCashFlow(
  cash: InsightCash[],
  today: string,
  weeks: number,
  account?: string,
) {
  const start = weekStart(today);
  return Array.from({ length: weeks }, (_, i) => {
    const from = addDays(start, (i - weeks + 1) * 7);
    const end = addDays(from, 6);
    return {
      from,
      to: end > today ? today : end,
      ...cashFlow(cash, { from, to: end > today ? today : end }, account),
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
export function actionItems(data: InsightData, today: string): ActionItem[] {
  const items: ActionItem[] = [];
  const customers = new Map<
    string,
    Extract<ActionItem, { kind: "receivable" }>
  >();
  for (const invoice of data.invoices) {
    const amount = outstanding(invoice, data.payments, today);
    if (!amount || invoice.dueDate >= today) continue;
    const previous = customers.get(invoice.contactId);
    customers.set(invoice.contactId, {
      kind: "receivable",
      id: `receivable:${invoice.contactId}`,
      customerId: invoice.contactId,
      name: invoice.contactName,
      amount: rupiah(amount + (previous?.amount ?? 0)),
      count: (previous?.count ?? 0) + 1,
      dueDate:
        previous && previous.dueDate < invoice.dueDate
          ? previous.dueDate
          : invoice.dueDate,
    });
  }
  items.push(...customers.values());
  for (const invoice of data.purchases) {
    const amount = outstanding(invoice, data.payments, today);
    if (amount && invoice.dueDate <= addDays(today, 7))
      items.push({
        kind: "payable",
        id: `payable:${invoice.id}`,
        invoiceId: invoice.id,
        status: amount < invoice.total ? "partial" : "unpaid",
        name: `${invoice.contactName} · ${invoice.number}`,
        amount,
        dueDate: invoice.dueDate,
      });
  }
  for (const p of data.products)
    if (p.stock < 0 || p.stock < p.minStock)
      items.push({
        kind: p.stock < 0 ? "negative-stock" : "low-stock",
        id: `stock:${p.id}`,
        productId: p.id,
        name: p.name,
        stock: p.stock,
        minStock: p.minStock,
      });
  for (const a of accountBalances(data, today))
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

export function documentProfits(
  lines: {
    documentId: string;
    lineTotal: Rupiah;
    qty: number;
    unitCost: Rupiah;
  }[],
): Map<string, Rupiah> {
  const profits = new Map<string, Rupiah>();
  for (const line of lines)
    profits.set(
      line.documentId,
      rupiah(
        (profits.get(line.documentId) ?? 0) +
          line.lineTotal -
          line.qty * line.unitCost,
      ),
    );
  return profits;
}
