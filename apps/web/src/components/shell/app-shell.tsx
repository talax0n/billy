import { roleLabels } from "@billy/core";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronsUpDown, LayoutDashboard, LogOut, Menu, MonitorSmartphone, Package, PanelLeftClose, PanelLeftOpen, Receipt, ShoppingCart, X } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { attentionQuery } from "../../lib/attention.ts";
import { meQuery, useLogout } from "../../lib/auth.ts";
import { settingsQuery } from "../../lib/settings.ts";
import { canOpen, type NavItem, navGroups, navItems, sectionOf, sectionTabs } from "../../nav.tsx";
import { cx } from "../../lib/cx.ts";
import { Button } from "../ui/button.tsx";
import { SectionContext } from "../ui/page.tsx";
import { LoginNotice } from "./login-notice.tsx";
import { NotificationBell } from "./notification-bell.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";

export function AppShell() {
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        void navigate({ to: "/kasir" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => setDrawerOpen(false), [pathname]);
  const { data: me } = useSuspenseQuery(meQuery);
  const section = useMemo(() => {
    const { leader, tabs } = sectionTabs(pathname, me?.role);
    return leader && tabs.length ? { title: leader.label, tabs: tabs.map((t) => ({ path: t.path, label: t.tab ?? t.label })) } : null;
  }, [pathname, me?.role]);
  // The drawer only exists below `md`; growing past it must not leave the rail expanded.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 48rem)");
    const close = () => wide.matches && setDrawerOpen(false);
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "0" : "1");
    } catch {
      // Storage blocked: the choice lasts for this page view.
    }
  };

  return (
    <div
      className={cx(
        "grid min-h-dvh gap-2.5 p-2.5 max-md:block max-md:p-0",
        collapsed ? "grid-cols-[56px_minmax(0,1fr)]" : "grid-cols-[220px_minmax(0,1fr)]",
      )}
    >
      {drawerOpen && <div className="fixed inset-0 z-30 bg-scrim md:hidden" onClick={() => setDrawerOpen(false)} />}
      <Sidebar
        collapsed={collapsed && !drawerOpen}
        drawerOpen={drawerOpen}
        onToggle={toggleCollapsed}
        onCloseDrawer={() => setDrawerOpen(false)}
      />
      <main className="min-w-0 overflow-hidden rounded-[14px] border border-line bg-panel max-md:min-h-dvh max-md:overflow-visible max-md:rounded-none max-md:border-0 max-md:pb-[calc(64px+env(safe-area-inset-bottom))]">
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-panel px-3 py-2 md:hidden">
          <ShopName />
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            <Button variant="ghost" size="icon" aria-label="Buka menu" onClick={() => setDrawerOpen(true)}>
              <Menu className="size-5" />
            </Button>
          </div>
        </div>
        <SectionContext.Provider value={section}>
          <Outlet />
        </SectionContext.Provider>
      </main>
      <TabBar />
      <LoginNotice />
    </div>
  );
}

const tabs = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/penjualan", label: "Penjualan", icon: Receipt },
  { to: "/pembelian", label: "Pembelian", icon: ShoppingCart },
  { to: "/produk", label: "Produk", icon: Package },
] as const;

/** Phones: the most used pages within thumb reach; the top bar's menu button opens the rest. */
function TabBar() {
  const tab = "flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1.5 text-xs text-muted";
  const current = sectionOf(useRouterState({ select: (s) => s.location.pathname }));
  return (
    <nav
      aria-label="Navigasi cepat"
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {tabs.map(({ to, label, icon: Icon }) => (
        <Link key={to} to={to} className={cx(tab, current === to && "font-medium text-ink")}>
          <Icon className="size-5" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** Phones: back office or cashier, like switching roles; Kasir opens the full-screen POS. */
function ModeSwitch() {
  const item = "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5";
  return (
    <div role="group" aria-label="Mode" className="flex gap-1 rounded-lg border border-line bg-panel p-1 md:hidden">
      <span aria-current="page" className={cx(item, "bg-ink font-medium text-panel")}>
        <LayoutDashboard className="size-4" />
        Kantor
      </span>
      <Link to="/kasir" className={cx(item, "text-ink-2 hover:text-ink")}>
        <MonitorSmartphone className="size-4" />
        Kasir
      </Link>
    </div>
  );
}

const COLLAPSED_KEY = "sidebar-collapsed";
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function ShopName() {
  const { data: settings } = useQuery(settingsQuery);
  const shopName = settings?.shopName ?? "";
  const initials = shopName
    .replace(/^toko\s+/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <div className="flex min-w-0 items-center gap-2.5 text-[15px] font-semibold">
      <div className="grid size-[26px] shrink-0 place-items-center rounded-[7px] bg-ink text-xs text-panel">{initials || "SK"}</div>
      <span className="truncate max-md:overflow-visible max-md:whitespace-nowrap group-data-[collapsed=true]/sb:hidden">{shopName || "Toko Cat Sumber Karya"}</span>
    </div>
  );
}

/**
 * Desktop: a sticky column that collapses to an icon rail (labels stay as screen-reader text).
 * Below `md`: an off-canvas drawer opened from the top bar.
 */
function Sidebar({
  collapsed,
  drawerOpen,
  onToggle,
  onCloseDrawer,
}: {
  collapsed: boolean;
  drawerOpen: boolean;
  onToggle: () => void;
  onCloseDrawer: () => void;
}) {
  const { data: settings } = useQuery(settingsQuery);
  const { data: me } = useSuspenseQuery(meQuery);
  const allowed = navItems.filter((item) => canOpen(item, me?.role));
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <aside
      data-collapsed={collapsed}
      className={cx(
        "group/sb sticky top-2.5 flex h-[calc(100dvh-20px)] flex-col gap-2.5 px-1 py-2",
        "max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:h-dvh max-md:w-[260px] max-md:bg-bg max-md:px-2.5 max-md:shadow-xl max-md:transition-transform",
        !drawerOpen && "max-md:translate-x-full",
      )}
    >
      <div className="flex items-center gap-1 px-2 py-1.5 group-data-[collapsed=true]/sb:flex-col group-data-[collapsed=true]/sb:px-0">
        {/* Phones already show the shop in the top bar. */}
        <div className="max-md:hidden">
          <ShopName />
        </div>
        <span className="text-[15px] font-semibold md:hidden">Menu</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto max-md:hidden group-data-[collapsed=true]/sb:ml-0"
          aria-label={collapsed ? "Lebarkan menu" : "Ciutkan menu"}
          title={collapsed ? "Lebarkan menu" : "Ciutkan menu"}
          onClick={onToggle}
        >
          <ToggleIcon className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" className="ml-auto md:hidden" aria-label="Tutup menu" onClick={onCloseDrawer}>
          <X className="size-5" />
        </Button>
      </div>
      <ModeSwitch />
      <Link
        to="/kasir"
        title="Buka Kasir (F2)"
        className="flex items-center max-md:hidden gap-2 rounded-[9px] bg-ink px-2.5 py-2 font-medium text-panel hover:opacity-90 group-data-[collapsed=true]/sb:justify-center"
      >
        <MonitorSmartphone className="size-4 shrink-0" />
        <span className="group-data-[collapsed=true]/sb:sr-only">Buka Kasir</span>
        <span className="ml-auto text-xs opacity-60 max-md:hidden group-data-[collapsed=true]/sb:hidden">F2</span>
      </Link>
      <nav className="flex min-h-0 flex-col overflow-y-auto">
        {navGroups.map((group) => (
          <div key={group} className="flex flex-col">
            <div className="px-2 pt-2.5 pb-1 text-xs text-muted group-data-[collapsed=true]/sb:hidden">{group}</div>
            <div className="mx-2 my-1.5 hidden border-t border-line group-data-[collapsed=true]/sb:block" />
            {allowed
              .filter((item) => item.group === group)
              .map((item) => (
                <NavLink key={item.path} item={item} />
              ))}
          </div>
        ))}
      </nav>
      <div className="flex-1" />
      <SyncCard deviceCode={settings?.posDeviceCode} />
      <AccountMenu />
    </aside>
  );
}

function NavLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  // Active on any of its tabs, e.g. Penjualan stays lit on /riwayat-kasir.
  const active = sectionOf(useRouterState({ select: (s) => s.location.pathname })) === item.path;
  const { data: attention } = useQuery({ ...attentionQuery, enabled: !!item.badge });
  const badge = item.badge && attention ? item.badge(attention) : 0;
  return (
    <Link
      to={item.path}
      title={item.label}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-ink-2 hover:text-ink max-md:py-2 group-data-[collapsed=true]/sb:justify-center",
        active && "border-line bg-panel font-medium text-ink",
      )}
    >
      <span className="relative shrink-0">
        <Icon className="size-4 opacity-60" />
        {badge > 0 && <span className="absolute -top-1 -right-1 hidden size-2 rounded-full bg-down group-data-[collapsed=true]/sb:block" />}
      </span>
      <span className="group-data-[collapsed=true]/sb:sr-only">{item.label}</span>
      {badge > 0 && (
        <span
          title={`${badge} perlu dicek`}
          className="ml-auto grid h-[18px] min-w-[18px] place-items-center rounded-full bg-down px-1.5 text-[11px] font-semibold text-panel tabular-nums group-data-[collapsed=true]/sb:hidden"
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

const subscribeOnline = (listener: () => void) => {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
};

/** Always tells the user whether their work can reach the server. The POS outbox adds its pending count here. */
function SyncCard({ deviceCode }: { deviceCode: string | undefined }) {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine);
  return (
    <div
      title={online ? "Online" : "Offline"}
      className="rounded-xl border border-line bg-panel px-3 py-2.5 group-data-[collapsed=true]/sb:flex group-data-[collapsed=true]/sb:justify-center group-data-[collapsed=true]/sb:px-0"
    >
      <div className="flex items-center gap-1.5">
        <span className={`size-[7px] rounded-full ${online ? "bg-up" : "bg-warn"}`} />
        <span className="group-data-[collapsed=true]/sb:sr-only">
          <b className="font-medium">{online ? "Online" : "Offline"}</b>
          <span className="text-muted"> · {online ? "tersambung" : "tidak tersambung"}</span>
        </span>
      </div>
      <div className="mt-0.5 text-xs text-muted group-data-[collapsed=true]/sb:hidden">
        {online ? "Perubahan langsung tersimpan" : "Simpan ditunda sampai online"}
        {deviceCode && ` · Kasir ${deviceCode}`}
      </div>
    </div>
  );
}

/** Who is signed in; opens a menu with the account-level pages, the theme and Keluar. */
function AccountMenu() {
  const { data: me } = useSuspenseQuery(meQuery);
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!me) return null;
  const links = navItems.filter((i) => (i.path === "/pengaturan" || i.path === "/log-aktivitas") && canOpen(i, me.role));
  const row = "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-ink-2 hover:bg-line-2 hover:text-ink";

  return (
    <div className="relative">
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
      {open && (
        <div
          role="menu"
          aria-label="Menu akun"
          className="absolute bottom-full left-0 z-50 mb-1.5 w-[232px] rounded-xl border border-line bg-panel p-1.5 shadow-lg max-md:right-0 max-md:left-auto"
        >
          <div className="truncate px-2 pt-1 pb-1.5 text-xs text-muted">
            {me.username} · {roleLabels[me.role]}
          </div>
          {links.map(({ path, label, icon: Icon }) => (
            <Link key={path} role="menuitem" to={path} className={row}>
              <Icon className="size-4 opacity-60" />
              {label}
            </Link>
          ))}
          <div className="my-1.5 border-t border-line" />
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <span className="text-ink-2">Tema</span>
            <ThemeToggle />
          </div>
          <div className="my-1.5 border-t border-line" />
          <button type="button" role="menuitem" className={row} onClick={logout}>
            <LogOut className="size-4 opacity-60" />
            Keluar
          </button>
        </div>
      )}
      <button
        type="button"
        aria-label="Menu akun"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-line-2 group-data-[collapsed=true]/sb:justify-center group-data-[collapsed=true]/sb:px-0"
      >
        <span title={me.name} className="grid size-[30px] shrink-0 place-items-center rounded-full bg-line text-xs font-medium text-ink-2">
          {me.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 group-data-[collapsed=true]/sb:hidden">
          <span className="block truncate font-medium">{me.name}</span>
          <span className="block text-xs text-muted">{roleLabels[me.role]}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted group-data-[collapsed=true]/sb:hidden" />
      </button>
    </div>
  );
}
