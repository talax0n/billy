import type { Role } from "@billy/core";
import {
  ArrowLeftRight,
  BellDot,
  Boxes,
  ClipboardList,
  FileSpreadsheet,
  FileStack,
  FileText,
  HandCoins,
  History,
  LayoutDashboard,
  type LucideIcon,
  Package,
  Receipt,
  ScrollText,
  ShieldAlert,
  Settings,
  ShoppingCart,
  Users,
  TriangleAlert,
  Truck,
  Wallet,
  WalletCards,
} from "lucide-react";
import { lazyRouteComponent, type RouteComponent } from "@tanstack/react-router";
import type { Attention } from "./lib/attention.ts";
const AuditPage = lazyRouteComponent(() => import("./routes/audit/audit-page.tsx"), "AuditPage");
const BundlesPage = lazyRouteComponent(() => import("./routes/invoice-bundles/bundles-page.tsx"), "BundlesPage");
const CashPage = lazyRouteComponent(() => import("./routes/cash/cash-page.tsx"), "CashPage");
const CashReportPage = lazyRouteComponent(() => import("./routes/cash-report/cash-report-page.tsx"), "CashReportPage");
const ContactsPage = lazyRouteComponent(() => import("./routes/contacts/contacts-page.tsx"), "ContactsPage");
const DeliveriesPage = lazyRouteComponent(() => import("./routes/deliveries/deliveries-page.tsx"), "DeliveriesPage");
const ExpensesPage = lazyRouteComponent(() => import("./routes/expenses/expenses-page.tsx"), "ExpensesPage");
const ActionsPage = lazyRouteComponent(() => import("./routes/insights/actions.tsx"), "ActionsPage");
const DashboardPage = lazyRouteComponent(() => import("./routes/insights/dashboard.tsx"), "DashboardPage");
const ProductsPage = lazyRouteComponent(() => import("./routes/products/products-page.tsx"), "ProductsPage");
const ReceivablesPage = lazyRouteComponent(() => import("./routes/receivables/receivables-page.tsx"), "ReceivablesPage");
const SalesPage = lazyRouteComponent(() => import("./routes/sales/sales-page.tsx"), "SalesPage");
const PayablesPage = lazyRouteComponent(() => import("./routes/payables/payables-page.tsx"), "PayablesPage");
const PurchasesPage = lazyRouteComponent(() => import("./routes/purchases/purchases-page.tsx"), "PurchasesPage");
const QuotationsPage = lazyRouteComponent(() => import("./routes/quotations/quotations-page.tsx"), "QuotationsPage");
const RiwayatKasirPage = lazyRouteComponent(() => import("./routes/riwayat-kasir/riwayat-kasir-page.tsx"), "RiwayatKasirPage");
const SettingsPage = lazyRouteComponent(() => import("./routes/settings/settings-page.tsx"), "SettingsPage");
const OpnamePage = lazyRouteComponent(() => import("./routes/opname/opname-page.tsx"), "OpnamePage");
const StockAlertsPage = lazyRouteComponent(() => import("./routes/stock/stock-page.tsx"), "StockAlertsPage");
const StockPage = lazyRouteComponent(() => import("./routes/stock/stock-page.tsx"), "StockPage");
const DailySummaryPage = lazyRouteComponent(() => import("./routes/watchdog/daily-page.tsx"), "DailySummaryPage");

export const navGroups = ["Umum", "Transaksi", "Keuangan", "Persediaan"] as const;

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Sidebar group; `"hidden"` is a route with no sidebar link of its own. */
  group: (typeof navGroups)[number] | "hidden";
  /** The page. Without one the route shows "Segera hadir". */
  page?: RouteComponent;
  /** Roles that may open it. Default: admin and staff (kasir never sees the shell). */
  roles?: Role[];
  /** Shown as a tab of this sidebar entry's page; with a visible `group` it also gets its own sidebar link. */
  section?: string;
  /** Label on the section's tab strip; defaults to `label`. */
  tab?: string;
  /** Count shown next to the sidebar link, from GET /api/insights/attention; 0 hides it. */
  badge?: (attention: Attention) => number;
}

/**
 * The single registry of back-office pages: each entry is a sidebar link and a route.
 * Adding a module's page is one entry here.
 */
export const navItems: NavItem[] = [
  { group: "Umum", path: "/", label: "Overview", icon: LayoutDashboard, page: DashboardPage },
  { group: "hidden", section: "/", path: "/ringkasan-harian", label: "Ringkasan harian", icon: ShieldAlert, page: DailySummaryPage, roles: ["admin"] },
  // Reached from the notification bell in every page header.
  { group: "hidden", path: "/tindakan", label: "Perlu Tindakan", icon: BellDot, page: ActionsPage },
  { group: "Transaksi", path: "/penjualan", label: "Penjualan", tab: "Faktur", icon: Receipt, page: SalesPage, badge: (a) => a.overdueInvoices.count },
  { group: "hidden", section: "/penjualan", path: "/riwayat-kasir", label: "Nota Kasir", icon: History, page: RiwayatKasirPage },
  { group: "hidden", section: "/penjualan", path: "/penawaran", label: "Penawaran", icon: FileText, page: QuotationsPage },
  { group: "hidden", section: "/penjualan", path: "/tukar-faktur", label: "Tukar Faktur", icon: FileStack, page: BundlesPage },
  { group: "Transaksi", path: "/antrian-antar", label: "Antrian Antar", icon: Truck, page: DeliveriesPage },
  { group: "Transaksi", path: "/pembelian", label: "Pembelian", icon: ShoppingCart, page: PurchasesPage },
  { group: "Keuangan", path: "/kas-bank", label: "Kas & Biaya", tab: "Kas & Bank", icon: Wallet, page: CashPage },
  { group: "hidden", section: "/kas-bank", path: "/biaya", label: "Biaya", icon: WalletCards, page: ExpensesPage },
  { group: "Keuangan", section: "/kas-bank", path: "/laporan-kas", label: "Laporan Debit Kredit", tab: "Laporan Kas", icon: FileSpreadsheet, page: CashReportPage, roles: ["admin", "staff"] },
  { group: "Keuangan", path: "/piutang", label: "Piutang & Hutang", tab: "Piutang", icon: HandCoins, page: ReceivablesPage },
  { group: "hidden", section: "/piutang", path: "/hutang", label: "Hutang", icon: ArrowLeftRight, page: PayablesPage },
  { group: "Persediaan", path: "/produk", label: "Produk & Stok", tab: "Produk", icon: Package, page: ProductsPage, badge: (a) => a.negativeStock + a.lowStock },
  { group: "hidden", section: "/produk", path: "/mutasi-stok", label: "Mutasi Stok", icon: Boxes, page: StockPage },
  { group: "hidden", section: "/produk", path: "/stok-menipis", label: "Stok Menipis", icon: TriangleAlert, page: StockAlertsPage },
  { group: "hidden", section: "/produk", path: "/stok-opname", label: "Stok Opname", icon: ClipboardList, page: OpnamePage },
  { group: "Persediaan", path: "/kontak", label: "Kontak", icon: Users, page: ContactsPage },
  // In the account menu at the bottom of the sidebar.
  { group: "hidden", path: "/log-aktivitas", label: "Log Aktivitas", icon: ScrollText, page: AuditPage, roles: ["admin"] },
  { group: "hidden", path: "/pengaturan", label: "Pengaturan", icon: Settings, page: SettingsPage },
];

export const canOpen = (item: NavItem, role: Role | undefined) => !item.roles || (!!role && item.roles.includes(role));

/** The sidebar entry a path belongs to: itself, or the section it is a tab of. */
export const sectionOf = (pathname: string) => navItems.find((i) => i.path === pathname)?.section ?? pathname;

/** The tabs of the section `pathname` belongs to that `role` may open; one tab means no strip. */
export function sectionTabs(pathname: string, role: Role | undefined) {
  const section = sectionOf(pathname);
  const leader = navItems.find((i) => i.path === section);
  const tabs = navItems.filter((i) => (i.path === section || i.section === section) && canOpen(i, role));
  return { leader, tabs: tabs.length > 1 ? tabs : [] };
}
