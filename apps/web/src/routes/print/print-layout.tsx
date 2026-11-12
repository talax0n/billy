import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { Button } from "../../components/ui/button.tsx";
import { settingsQuery } from "../../lib/settings.ts";

/** Paper always prints light: swap the theme for the print job and put the user's choice back after. */
function usePrintInLight() {
  useEffect(() => {
    const root = document.documentElement;
    let previous: string | undefined;
    const before = () => {
      previous = root.dataset.theme;
      root.dataset.theme = "light";
    };
    const after = () => {
      if (previous === undefined) delete root.dataset.theme;
      else root.dataset.theme = previous;
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
}

/** A printable document outside the app shell: shop letterhead, title block, body, A4/A5 friendly. */
export function PrintLayout({
  title,
  number,
  meta,
  children,
}: {
  title: string;
  number: string;
  /** Label → value pairs under the number (date, due date…). */
  meta: [string, ReactNode][];
  children: ReactNode;
}) {
  usePrintInLight();
  const { data: shop } = useQuery(settingsQuery);
  useEffect(() => {
    document.title = number;
  }, [number]);

  return (
    <div className="min-h-dvh bg-bg py-8 print:bg-panel print:py-0">
      <style>{"@page { margin: 12mm; }"}</style>
      <div className="mx-auto mb-4 flex max-w-[190mm] justify-end gap-2 print:hidden">
        <Button onClick={() => window.close()}>Tutup</Button>
        <Button variant="primary" onClick={() => window.print()}>
          <Printer className="size-4" />
          Cetak
        </Button>
      </div>
      <article className="mx-auto flex max-w-[190mm] flex-col gap-5 rounded-xl border border-line bg-panel p-[12mm] text-[12px] print:max-w-none print:rounded-none print:border-0 print:p-0">
        <header className="flex items-start justify-between gap-6 border-b border-ink pb-3">
          <div>
            <div className="text-[17px] font-semibold tracking-tight">{shop?.shopName}</div>
            {shop?.address && <div className="text-ink-2">{shop.address}</div>}
            <div className="text-ink-2">
              {[shop?.phone && `Telp ${shop.phone}`, shop?.whatsapp && `WA ${shop.whatsapp}`].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[15px] font-semibold tracking-wide uppercase">{title}</div>
            <div className="font-medium tabular-nums">{number}</div>
            <dl className="mt-1 grid grid-cols-[auto_auto] justify-end gap-x-3 text-ink-2">
              {meta.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt>{label}</dt>
                  <dd className="tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </header>
        {children}
      </article>
    </div>
  );
}

export function PartyBlock({ label, party }: { label: string; party: { name: string; address: string; phone: string } }) {
  return (
    <section>
      <div className="text-xs text-muted">{label}</div>
      <div className="font-medium">{party.name}</div>
      {party.address && <div className="text-ink-2">{party.address}</div>}
      {party.phone && <div className="text-ink-2">{party.phone}</div>}
    </section>
  );
}

/** Signature boxes at the foot of a document. */
export function Signatures({ roles }: { roles: [string, (string | undefined)?][] }) {
  return (
    <footer className="mt-6 grid grid-cols-2 gap-10 break-inside-avoid text-center">
      {roles.map(([role, name]) => (
        <div key={role} className="flex flex-col items-center gap-14">
          <span className="text-ink-2">{role}</span>
          <span className="min-w-40 border-t border-ink pt-1">{name ?? "\u00a0"}</span>
        </div>
      ))}
    </footer>
  );
}

export const printTable = {
  table: "w-full border-collapse",
  th: "border-y border-ink px-1.5 py-1 text-left text-[11px] font-medium",
  td: "border-b border-line px-1.5 py-1 align-top",
};
