import { formatDate, formatRupiah, rupiah } from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { EmptyState } from "../../components/ui/page.tsx";
import { cx } from "../../lib/cx.ts";
import { PrintPage, RETURN_POLICY, type Shop } from "../print/print-layout.tsx";
import { invoiceQuery } from "./queries.ts";

type Invoice = NonNullable<ReturnType<typeof usePrintedInvoice>["data"]>;

function usePrintedInvoice() {
  const { id } = useParams({ strict: false });
  return useQuery({ ...invoiceQuery(id ?? ""), enabled: Boolean(id) });
}

const money = (value: number) => formatRupiah(rupiah(value));
const cell = "border-b border-black px-1 py-0.5 align-top";
const head = "border-y border-black px-1 py-0.5 text-left font-semibold";
const num = "text-right whitespace-nowrap tabular-nums";

/**
 * The faktur's sheet, shared by the surat jalan: letterhead left, title, number and dates right,
 * Kepada, the body, signatures. Small type and tight spacing so a short document fits the top of
 * one 9.5 x 5.5 in sheet. All black, for the dot-matrix ribbon. No boxed cells.
 */
function InvoiceSheet({
  invoice,
  title,
  number,
  dates,
  children,
}: {
  invoice: Invoice;
  title: string;
  number: string;
  dates: [string, string][];
  children: (shop: Shop | undefined) => ReactNode;
}) {
  return (
    <PrintPage number={number} className="gap-1.5 text-[9.5pt] leading-tight">
      {(shop) => (
        <>
          <header className="flex items-start justify-between gap-6 border-b border-black pb-1">
            <div className="min-w-0">
              <div className="text-[14pt] leading-tight font-bold">{shop?.shopName}</div>
              {shop?.address && <div>{shop.address}</div>}
              <div>{[shop?.phone && `Telp ${shop.phone}`, shop?.whatsapp && `WA ${shop.whatsapp}`].filter(Boolean).join(" · ")}</div>
            </div>
            <div className="shrink-0 text-right">
              <h1 className="text-[12pt] font-bold uppercase">{title}</h1>
              <div className="font-semibold tabular-nums">{number}</div>
              <dl className="grid grid-cols-[auto_auto] justify-end gap-x-3">
                {dates.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt>{label}</dt>
                    <dd className="tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </header>
          <section>
            <span className="text-[8pt]">Kepada </span>
            <span className="font-semibold">{invoice.customer.name}</span>
            {[invoice.customer.address, invoice.customer.phone].filter(Boolean).map((text) => (
              <div key={text}>{text}</div>
            ))}
          </section>
          {children(shop)}
          <footer className="grid grid-cols-2 gap-10 break-inside-avoid text-center">
            {(
              [
                ["Penerima", undefined],
                ["Hormat kami", shop?.invoiceSigner || undefined],
              ] as const
            ).map(([role, name]) => (
              <div key={role} className="flex flex-col items-center gap-7">
                <span>{role}</span>
                <span className="min-w-40 border-t border-black pt-0.5">{name ?? " "}</span>
              </div>
            ))}
          </footer>
          <p className="text-[8pt] font-bold">{RETURN_POLICY}</p>
        </>
      )}
    </PrintPage>
  );
}

/** The faktur: No/Barang/Jumlah/Harga/Diskon/Total, the shop's rekening beside the totals. */
export function InvoicePrintPage() {
  const { data: invoice, error } = usePrintedInvoice();
  if (error) return <EmptyState title={error.message} />;
  if (!invoice) return null;
  return (
    <InvoiceSheet
      invoice={invoice}
      title={invoice.state.status === "void" ? "Faktur (VOID)" : "Faktur penjualan"}
      number={invoice.number}
      dates={[
        ["Tanggal", formatDate(invoice.date)],
        ["Jatuh tempo", formatDate(invoice.dueDate)],
      ]}
    >
      {(shop) => (
        <>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={cx(head, "w-6")}>No</th>
                <th className={head}>Barang</th>
                <th className={cx(head, "text-right")}>Jumlah</th>
                <th className={cx(head, "text-right")}>Harga</th>
                <th className={cx(head, "text-right")}>Diskon</th>
                <th className={cx(head, "text-right")}>Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line, i) => (
                <tr key={line.id} className="break-inside-avoid">
                  <td className={cx(cell, "tabular-nums")}>{i + 1}</td>
                  <td className={cell}>
                    {line.productName} {line.variant}
                    {line.note && <div className="text-[8pt]">{line.note}</div>}
                  </td>
                  <td className={cx(cell, num)}>
                    {line.qty} {line.unit}
                  </td>
                  <td className={cx(cell, num)}>{money(line.unitPrice)}</td>
                  <td className={cx(cell, num)}>{line.discountAmount ? money(line.discountAmount) : "—"}</td>
                  <td className={cx(cell, num)}>{money(line.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-start justify-between gap-8 break-inside-avoid">
            <div className="whitespace-pre-line" data-testid="faktur-bank">
              {shop?.invoiceBankText}
            </div>
            <dl className="grid min-w-52 shrink-0 grid-cols-[1fr_auto] gap-x-4 tabular-nums">
              <dt>Subtotal</dt>
              <dd className="text-right">{money(invoice.subtotal)}</dd>
              {invoice.discountAmount > 0 && (
                <>
                  <dt>Diskon</dt>
                  <dd className="text-right">− {money(invoice.discountAmount)}</dd>
                </>
              )}
              <dt className="border-t border-black font-bold">Total</dt>
              <dd className="border-t border-black text-right font-bold">{money(invoice.total)}</dd>
              {invoice.paid > 0 && (
                <>
                  <dt>Dibayar</dt>
                  <dd className="text-right">{money(invoice.paid)}</dd>
                  <dt>Sisa</dt>
                  <dd className="text-right">{money(invoice.state.outstanding)}</dd>
                </>
              )}
            </dl>
          </div>
        </>
      )}
    </InvoiceSheet>
  );
}

/** Delivery note: what left the shop, no prices, on the faktur's sheet. Number `SO-…` becomes `SJ-…`. */
export function DeliveryNotePrintPage() {
  const { data: invoice, error } = usePrintedInvoice();
  if (error) return <EmptyState title={error.message} />;
  if (!invoice) return null;
  return (
    <InvoiceSheet invoice={invoice} title="Surat jalan" number={invoice.number.replace(/^SO-/, "SJ-")} dates={[["Tanggal", formatDate(invoice.date)]]}>
      {() => (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={cx(head, "w-6")}>No</th>
              <th className={head}>Barang</th>
              <th className={head}>Ket</th>
              <th className={cx(head, "text-right")}>Jumlah</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, i) => (
              <tr key={line.id} className="break-inside-avoid">
                <td className={cx(cell, "tabular-nums")}>{i + 1}</td>
                <td className={cell}>
                  {line.productName} {line.variant}
                </td>
                <td className={cell}>{line.note}</td>
                <td className={cx(cell, num)}>
                  {line.qty} {line.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </InvoiceSheet>
  );
}
