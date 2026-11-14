import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
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

/** Prints once the page and the shop letterhead have rendered, so opening a document is one click. */
function useAutoPrint(ready: boolean) {
  const printed = useRef(false);
  useEffect(() => {
    if (!ready || printed.current) return;
    printed.current = true;
    void document.fonts.ready.then(() => requestAnimationFrame(() => window.print()));
  }, [ready]);
}

/**
 * A printable document in the old app's layout: letterhead left, date, number and customer right,
 * title, then the body. No page size: the printer's own paper decides, as the old app did. The
 * article stays 176 mm wide, which the dot-matrix prints in full; wider got cut off on the right.
 */
export function PrintLayout({
  title,
  numberLabel,
  number,
  date,
  meta,
  children,
}: {
  title: string;
  /** "NO Faktur", "NO Surat Jalan"… */
  numberLabel: string;
  number: string;
  date: string;
  /** Label → value rows under the number (customer, due date…). */
  meta: [string, ReactNode][];
  children: ReactNode;
}) {
  usePrintInLight();
  const { data: shop } = useQuery(settingsQuery);
  useAutoPrint(Boolean(shop));
  const rows: [string, ReactNode][] = [["Tanggal", <strong>{date}</strong>], [numberLabel, <strong className="text-[13pt]">{number}</strong>], ...meta];
  useEffect(() => {
    document.title = number;
  }, [number]);

  return (
    <div className="min-h-dvh bg-bg py-8 print:min-h-0 print:bg-white print:py-0">
      <style>{"@page { margin: 10mm 14mm; }"}</style>
      <div className="mx-auto mb-4 flex w-[176mm] justify-end gap-2 print:hidden">
        <Button onClick={() => window.close()}>Tutup</Button>
        <Button variant="primary" onClick={() => window.print()}>
          <Printer className="size-4" />
          Cetak
        </Button>
      </div>
      <article className="mx-auto flex w-[176mm] flex-col gap-3 bg-white p-[8mm] font-['Times_New_Roman',Times,serif] text-[12pt] leading-tight text-black shadow print:m-0 print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6">
          <div>
            <div className="max-w-[85mm] text-[20pt] leading-none font-bold uppercase">{shop?.shopName}</div>
            {shop?.address && <div className="mt-4 max-w-[70mm]">{shop.address}</div>}
            <div className="mt-2">
              {shop?.phone && (
                <div>
                  <span className="text-[9pt]">Telp</span> : {shop.phone}
                </div>
              )}
              {shop?.whatsapp && (
                <div>
                  <span className="text-[9pt]">WA</span> : {shop.whatsapp}
                </div>
              )}
            </div>
          </div>
          <dl className="w-[62mm] shrink-0 pt-1 text-[11pt]">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt className="inline text-[9pt]">{label}: </dt>
                <dd className="inline">{value}</dd>
              </div>
            ))}
          </dl>
        </header>
        <h1 className="mt-2 text-[14pt] font-bold uppercase">{title}</h1>
        {children}
      </article>
    </div>
  );
}

/** Header rows naming who a document is for, as the old app printed them. */
export const partyMeta = (label: string, party: { name: string; address: string }): [string, ReactNode][] => [
  [label, <strong>{party.name}</strong>],
  ...(party.address ? [["Alamat", party.address] as [string, ReactNode]] : []),
];

// ponytail: fixed shop policy, move to settings if the shop ever wants to edit it
export const RETURN_POLICY = "Cat tinting/adukan tidak bisa di retur / dikembalikan";

/** Signature lines at the foot of a document; an unnamed signer gets a dotted blank in brackets. */
export function Signatures({ roles }: { roles: [string, (string | undefined)?][] }) {
  return (
    <footer className="mt-1 grid grid-cols-2 break-inside-avoid text-center">
      {roles.map(([role, name]) => (
        <div key={role} className="flex flex-col items-center gap-[12mm]">
          <span className="text-[9pt] font-bold">{role}</span>
          <span className="text-[8pt]">({name || ".".repeat(60)})</span>
        </div>
      ))}
    </footer>
  );
}

/** The old app's bordered table. */
export const printTable = {
  table: "w-full border-collapse",
  th: "border border-black px-1 py-0.5 text-center text-[10pt] font-bold",
  td: "border border-black px-1 align-middle",
};

/** `246.000`: amounts inside a table, without the Rp the totals carry. */
export const amount = (value: number) => value.toLocaleString("id-ID");
