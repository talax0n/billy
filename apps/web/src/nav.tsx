import type { Role } from "@billy/core";
import {
  ArrowLeftRight,
  BellDot,
  Boxes,
  FileStack,
  HandCoins,
  History,
  LayoutDashboard,
  type LucideIcon,
  Package,
  Receipt,
  ScrollText,
  Settings,
  ShoppingCart,
  Users,
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
import { RiwayatKasirPage } from "./routes/riwayat-kasir/riwayat-kasir-page.tsx";
import { SettingsPage } from "./routes/settings/settings-page.tsx";
import { StockPage } from "./routes/stock/stock-page.tsx";

export const navGroups = ["Umum", "Transaksi", "Keuangan", "Persediaan"] as const;

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Sidebar group; `null` sits at the bottom of the sidebar, `"hidden"` is a route with no sidebar link. */
  group: (typeof navGroups)[number] | null | "hidden";
  /** The page. Without one the route shows "Segera hadir". */
  page?: () => ReactNode;
  /** Roles that may open it. Default: admin and staff (kasir never sees the shell). */
  roles?: Role[];
}

/**
 * The single registry of back-office pages: each entry is a sidebar link and a route.
 * Adding a module's page is one entry here.
 */
export const navItems: NavItem[] = [
  { group: "Umum", path: "/", label: "Overview", icon: LayoutDashboard, page: DashboardPage },
  // Reached from the notification bell in every page header.
  { group: "hidden", path: "/tindakan", label: "Perlu Tindakan", icon: BellDot, page: ActionsPage },
  { group: "Transaksi", path: "/penjualan", label: "Penjualan", icon: Receipt, page: SalesPage },
  { group: "Transaksi", path: "/pembelian", label: "Pembelian", icon: ShoppingCart, page: PurchasesPage },
  { group: "Transaksi", path: "/biaya", label: "Biaya", icon: WalletCards, page: ExpensesPage },
  { group: "Transaksi", path: "/tukar-faktur", label: "Tukar Faktur", icon: FileStack, page: BundlesPage },
  { group: "Transaksi", path: "/riwayat-kasir", label: "Riwayat Kasir", icon: History, page: RiwayatKasirPage },
  { group: "Keuangan", path: "/kas-bank", label: "Kas & Bank", icon: Wallet, page: CashPage },
  { group: "Keuangan", path: "/piutang", label: "Piutang", icon: HandCoins, page: ReceivablesPage },
  { group: "Keuangan", path: "/hutang", label: "Hutang", icon: ArrowLeftRight, page: PayablesPage },
  { group: "Persediaan", path: "/produk", label: "Produk", icon: Package, page: ProductsPage },
  { group: "Persediaan", path: "/mutasi-stok", label: "Mutasi Stok", icon: Boxes, page: StockPage },
  { group: "Persediaan", path: "/kontak", label: "Kontak", icon: Users, page: ContactsPage },
  { group: null, path: "/log-aktivitas", label: "Log Aktivitas", icon: ScrollText, page: AuditPage, roles: ["admin"] },
  { group: null, path: "/pengaturan", label: "Pengaturan", icon: Settings, page: SettingsPage },
];
