import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { ThemeToggle } from "../components/shell/theme-toggle.tsx";
import { Button } from "../components/ui/button.tsx";
import { EmptyState } from "../components/ui/page.tsx";
import { meQuery, useLogout } from "../lib/auth.ts";
import { settingsQuery } from "../lib/settings.ts";

/** Placeholder for the full-screen POS. */
export function KasirPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const { data: settings } = useQuery(settingsQuery);
  const logout = useLogout();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-4 border-b border-line bg-panel px-4 py-2.5">
        <b className="font-semibold">Kasir</b>
        <span className="text-muted">{settings?.shopName}</span>
        <div className="ml-auto flex items-center gap-3">
          {me?.role !== "kasir" && (
            <Link to="/" className="text-ink-2 hover:text-ink">
              Kembali ke dasbor
            </Link>
          )}
          <span className="text-ink-2">{me?.name}</span>
          <div className="w-24">
            <ThemeToggle />
          </div>
          <Button variant="ghost" size="icon" aria-label="Keluar" title="Keluar" onClick={logout}>
            <LogOut className="size-4" />
          </Button>
        </div>
      </header>
      <main className="grid flex-1 place-items-center">
        <EmptyState title="Layar kasir segera hadir" description="Penjualan kasir, riwayat struk, dan cetak ulang sedang dibuat." />
      </main>
    </div>
  );
}
