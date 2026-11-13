import type { Role } from "@billy/core";
import {
  ArrowLeftRight,
  BellDot,
  Boxes,
  ClipboardCheck,
  ClipboardList,
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
  Wallet,
  WalletCards,
} from "lucide-react";
import type { ReactNode } from "react";
import { AuditPage } from "./routes/audit/audit-page.tsx";
import { BundlesPage } from "./routes/invoice-bundles/bundles-page.tsx";
import { CashPage } from "./routes/cash/cash-page.tsx";
import { ContactsPage } from "./routes/contacts/contacts-page.tsx";
import { ExpensesPage } from "./routes/expenses/expenses-page.tsx";
import { ActionsPage } from "./routes/insights/actions.tsx";
import { DashboardPage } from "./routes/insights/dashboard.tsx";
import { ProductsPage } from "./routes/products/products-page.tsx";
import { ReceivablesPage } from "./routes/receivables/receivables-page.tsx";
import { SalesPage } from "./routes/sales/sales-page.tsx";
import { PayablesPage } from "./routes/payables/payables-page.tsx";
import { PurchasesPage } from "./routes/purchases/purchases-page.tsx";
import { QuotationsPage } from "./routes/quotations/quotations-page.tsx";
import { RiwayatKasirPage } from "./routes/riwayat-kasir/riwayat-kasir-page.tsx";
import { SettingsPage } from "./routes/settings/settings-page.tsx";
import { OpnamePage } from "./routes/opname/opname-page.tsx";
import { ShiftsPage } from "./routes/shifts/shifts-page.tsx";
import { StockAlertsPage, StockPage } from "./routes/stock/stock-page.tsx";
import { DailySummaryPage } from "./routes/watchdog/daily-page.tsx";

export const navGroups = ["Umum", "Transaksi", "Keuangan", "Persediaan"] as const;

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Sidebar group; `"hidden"` is a route with no sidebar link of its own. */
  group: (typeof navGroups)[number] | "hidden";
  /** The page. Without one the route shows "Segera hadir". */
  page?: () => ReactNode;
  /** Roles that may open it. Default: admin and staff (kasir never sees the shell). */
  roles?: Role[];
  /** Shown as a tab of this sidebar entry's page instead of its own sidebar link. */
  section?: string;
  /** Label on the section's tab strip; defaults to `label`. */
  tab?: string;
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
  { group: "Transaksi", path: "/penjualan", label: "Penjualan", tab: "Faktur", icon: Receipt, page: SalesPage },
  { group: "hidden", section: "/penjualan", path: "/riwayat-kasir", label: "Nota Kasir", icon: History, page: RiwayatKasirPage },
  { group: "hidden", section: "/penjualan", path: "/penawaran", label: "Penawaran", icon: FileText, page: QuotationsPage },
  { group: "hidden", section: "/penjualan", path: "/tukar-faktur", label: "Tukar Faktur", icon: FileStack, page: BundlesPage },
  { group: "Transaksi", path: "/pembelian", label: "Pembelian", icon: ShoppingCart, page: PurchasesPage },
  { group: "Keuangan", path: "/kas-bank", label: "Kas & Biaya", tab: "Kas & Bank", icon: Wallet, page: CashPage },
  { group: "hidden", section: "/kas-bank", path: "/biaya", label: "Biaya", icon: WalletCards, page: ExpensesPage },
  { group: "hidden", section: "/kas-bank", path: "/laporan-shift", label: "Laporan Shift", icon: ClipboardCheck, page: ShiftsPage, roles: ["admin"] },
  { group: "Keuangan", path: "/piutang", label: "Piutang & Hutang", tab: "Piutang", icon: HandCoins, page: ReceivablesPage },
  { group: "hidden", section: "/piutang", path: "/hutang", label: "Hutang", icon: ArrowLeftRight, page: PayablesPage },
  { group: "Persediaan", path: "/produk", label: "Produk & Stok", tab: "Produk", icon: Package, page: ProductsPage },
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
