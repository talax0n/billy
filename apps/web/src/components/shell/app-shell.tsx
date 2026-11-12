import { roleLabels } from "@billy/core";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { LogOut, MonitorSmartphone } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { meQuery, useLogout } from "../../lib/auth.ts";
import { settingsQuery } from "../../lib/settings.ts";
import { type NavItem, navGroups, navItems } from "../../nav.tsx";
import { Button } from "../ui/button.tsx";
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

  return (
    <div className="grid min-h-dvh grid-cols-[220px_minmax(0,1fr)] gap-2.5 p-2.5">
      <Sidebar />
      <main className="min-w-0 overflow-hidden rounded-[14px] border border-line bg-panel">
        <Outlet />
      </main>
    </div>
  );
}

function Sidebar() {
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
    <aside className="sticky top-2.5 flex h-[calc(100dvh-20px)] flex-col gap-2.5 px-1 py-2">
      <div className="flex items-center gap-2.5 px-2 py-1.5 text-[15px] font-semibold">
        <div className="grid size-[26px] place-items-center rounded-[7px] bg-ink text-xs text-panel">{initials || "B"}</div>
        <span className="truncate">{shopName || "Billy"}</span>
      </div>
      <Link
        to="/kasir"
        className="flex items-center gap-2 rounded-[9px] bg-ink px-2.5 py-2 font-medium text-panel hover:opacity-90"
      >
        <MonitorSmartphone className="size-4" />
        Buka Kasir
        <span className="ml-auto text-[11px] opacity-60">F2</span>
      </Link>
      <nav className="flex min-h-0 flex-col overflow-y-auto">
        {navGroups.map((group) => (
          <div key={group} className="flex flex-col">
            <div className="px-2 pt-2.5 pb-1 text-[11.5px] text-muted">{group}</div>
            {navItems
              .filter((item) => item.group === group)
              .map((item) => (
                <NavLink key={item.path} item={item} />
              ))}
          </div>
        ))}
      </nav>
      <div className="flex-1" />
      <SyncCard deviceCode={settings?.posDeviceCode} />
      <nav className="flex flex-col">
        {navItems
          .filter((item) => item.group === null)
          .map((item) => (
            <NavLink key={item.path} item={item} />
          ))}
      </nav>
      <ThemeToggle />
      <UserCard />
    </aside>
  );
}

function NavLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.path}
      activeOptions={{ exact: item.path === "/" }}
      className="flex items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-ink-2 hover:text-ink"
      activeProps={{ className: "border-line! bg-panel font-medium text-ink!" }}
    >
      <Icon className="size-4 opacity-60" />
      {item.label}
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
    <div className="rounded-xl border border-line bg-panel px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className={`size-[7px] rounded-full ${online ? "bg-up" : "bg-warn"}`} />
        <b className="font-medium">{online ? "Online" : "Offline"}</b>
        <span className="text-muted">· {online ? "tersambung" : "tidak tersambung"}</span>
      </div>
      <div className="mt-0.5 text-xs text-muted">
        {online ? "Perubahan langsung tersimpan" : "Simpan ditunda sampai online"}
        {deviceCode && ` · Kasir ${deviceCode}`}
      </div>
    </div>
  );
}

function UserCard() {
  const { data: me } = useSuspenseQuery(meQuery);
  const logout = useLogout();
  if (!me) return null;
  return (
    <div className="flex items-center gap-2.5 px-2 py-1">
      <div className="grid size-[30px] place-items-center rounded-full bg-line text-xs font-medium text-ink-2">
        {me.name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{me.name}</div>
        <div className="text-xs text-muted">{roleLabels[me.role]}</div>
      </div>
      <Button variant="ghost" size="icon" aria-label="Keluar" title="Keluar" onClick={logout}>
        <LogOut className="size-4" />
      </Button>
    </div>
  );
}
