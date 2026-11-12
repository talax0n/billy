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
import { PayablesPage } from "./routes/payables/payables-page.tsx";
import { ProductsPage } from "./routes/products/products-page.tsx";
import { PurchasesPage } from "./routes/purchases/purchases-page.tsx";
import { SettingsPage } from "./routes/settings/settings-page.tsx";
import { StockPage } from "./routes/stock/stock-page.tsx";

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
  { group: "Transaksi", path: "/penjualan", label: "Penjualan", icon: Receipt },
  { group: "Transaksi", path: "/pembelian", label: "Pembelian", icon: ShoppingCart, page: PurchasesPage },
  { group: "Transaksi", path: "/biaya", label: "Biaya", icon: WalletCards },
  { group: "Transaksi", path: "/tukar-faktur", label: "Tukar Faktur", icon: FileStack },
  { group: "Transaksi", path: "/riwayat-kasir", label: "Riwayat Kasir", icon: History },
  { group: "Keuangan", path: "/kas-bank", label: "Kas & Bank", icon: Wallet },
  { group: "Keuangan", path: "/piutang", label: "Piutang", icon: HandCoins },
  { group: "Keuangan", path: "/hutang", label: "Hutang", icon: ArrowLeftRight, page: PayablesPage },
  { group: "Persediaan", path: "/produk", label: "Produk", icon: Package, page: ProductsPage },
  { group: "Persediaan", path: "/mutasi-stok", label: "Mutasi Stok", icon: Boxes, page: StockPage },
  { group: "Persediaan", path: "/kontak", label: "Kontak", icon: Users },
  { group: null, path: "/pengaturan", label: "Pengaturan", icon: Settings, page: SettingsPage },
];
