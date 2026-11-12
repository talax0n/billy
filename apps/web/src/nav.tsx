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
  Settings,
  ShoppingCart,
  Users,
  Wallet,
  WalletCards,
} from "lucide-react";
import type { ReactNode } from "react";
import { BundlesPage } from "./routes/invoice-bundles/bundles-page.tsx";
import { CashPage } from "./routes/cash/cash-page.tsx";
import { ContactsPage } from "./routes/contacts/contacts-page.tsx";
import { ExpensesPage } from "./routes/expenses/expenses-page.tsx";
import { ProductsPage } from "./routes/products/products-page.tsx";
import { ReceivablesPage } from "./routes/receivables/receivables-page.tsx";
import { SalesPage } from "./routes/sales/sales-page.tsx";
import { SettingsPage } from "./routes/settings/settings-page.tsx";

export const navGroups = ["Umum", "Transaksi", "Keuangan", "Persediaan"] as const;

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Sidebar group; `null` sits at the bottom of the sidebar. */
  group: (typeof navGroups)[number] | null;
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
  { group: "Umum", path: "/", label: "Ringkasan", icon: LayoutDashboard },
  { group: "Umum", path: "/tindakan", label: "Perlu Tindakan", icon: BellDot },
  { group: "Transaksi", path: "/penjualan", label: "Penjualan", icon: Receipt, page: SalesPage },
  { group: "Transaksi", path: "/pembelian", label: "Pembelian", icon: ShoppingCart },
  { group: "Transaksi", path: "/biaya", label: "Biaya", icon: WalletCards, page: ExpensesPage },
  { group: "Transaksi", path: "/tukar-faktur", label: "Tukar Faktur", icon: FileStack, page: BundlesPage },
  { group: "Transaksi", path: "/riwayat-kasir", label: "Riwayat Kasir", icon: History },
  { group: "Keuangan", path: "/kas-bank", label: "Kas & Bank", icon: Wallet, page: CashPage },
  { group: "Keuangan", path: "/piutang", label: "Piutang", icon: HandCoins, page: ReceivablesPage },
  { group: "Keuangan", path: "/hutang", label: "Hutang", icon: ArrowLeftRight },
  { group: "Persediaan", path: "/produk", label: "Produk", icon: Package, page: ProductsPage },
  { group: "Persediaan", path: "/mutasi-stok", label: "Mutasi Stok", icon: Boxes },
  { group: "Persediaan", path: "/kontak", label: "Kontak", icon: Users, page: ContactsPage },
  { group: null, path: "/pengaturan", label: "Pengaturan", icon: Settings, page: SettingsPage },
];
