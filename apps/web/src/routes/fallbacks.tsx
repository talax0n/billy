import type { ReactNode } from "react";
import { type ErrorComponentProps, Link } from "@tanstack/react-router";
import { Button } from "../components/ui/button.tsx";
import { Loading } from "../components/ui/page.tsx";

const link = "inline-flex h-9 items-center rounded-lg border border-line bg-panel px-3.5 font-medium hover:bg-line-2";

function Screen({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <main className="grid min-h-[70dvh] place-items-center px-6 text-center">
      <div className="flex max-w-sm flex-col items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted">{description}</p>
        <div className="mt-3 flex gap-2">{children}</div>
      </div>
    </main>
  );
}

export function RoutePending() {
  return <Loading className="min-h-[50dvh]" />;
}

export function NotFoundPage() {
  return (
    <Screen title="Halaman tidak ditemukan" description="Alamat ini tidak ada atau sudah dipindah.">
      <Link to="/" className={link}>
        Kembali ke beranda
      </Link>
    </Screen>
  );
}

/** A page that threw, or whose code chunk is gone after a deploy; a full reload fetches the new build. */
export function RouteError({ error }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : "";
  const stale = /dynamically imported module|Importing a module script failed|error loading dynamically/i.test(message);
  return (
    <Screen
      title={stale ? "Versi baru tersedia" : "Terjadi kesalahan"}
      description={stale ? "Aplikasi sudah diperbarui. Muat ulang untuk melanjutkan." : message || "Halaman ini gagal dimuat."}
    >
      <Button variant="primary" onClick={() => location.reload()}>
        Muat ulang
      </Button>
      {!stale && (
        <Link to="/" className={link}>
          Ke beranda
        </Link>
      )}
    </Screen>
  );
}
