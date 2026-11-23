import { formatDate, formatRupiah, rupiah } from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { EmptyState } from "../../components/ui/page.tsx";
import { settingsQuery } from "../../lib/settings.ts";
import { cx } from "../../lib/cx.ts";
import { amount, PrintLayout, PrintPage, partyMeta, printTable as t, RETURN_POLICY, Signatures } from "../print/print-layout.tsx";
import { invoiceQuery } from "./queries.ts";

function usePrintedInvoice() {
  const { id } = useParams({ strict: false });
  return useQuery({ ...invoiceQuery(id ?? ""), enabled: Boolean(id) });
}

const money = (value: number) => formatRupiah(rupiah(value));
const cell = "border-b border-black px-1.5 py-1 align-top";
const head = "border-y border-black px-1.5 py-1 text-left font-semibold";

/**
 * The faktur in the layout the shop asked to keep: letterhead left, title, number and dates right,
 * No/Barang/Jumlah/Harga/Diskon/Total, the shop's rekening beside the totals. All black, for the
 * dot-matrix ribbon.
 */
export function InvoicePrintPage() {
  const { data: invoice, error } = usePrintedInvoice();
  if (error) return <EmptyState title={error.message} />;
  if (!invoice) return null;
  return (
    <PrintPage number={invoice.number} className="gap-3 text-[11pt] leading-snug">
      {(shop) => (
        <>
          <header className="flex items-start justify-between gap-6 border-b border-black pb-2">
            <div className="min-w-0">
              <div className="text-[18pt] leading-tight font-bold">{shop?.shopName}</div>
              {shop?.address && <div className="mt-1 text-[12pt]">{shop.address}</div>}
              <div className="text-[12pt]">
                {[shop?.phone && `Telp ${shop.phone}`, shop?.whatsapp && `WA ${shop.whatsapp}`].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <h1 className="text-[15pt] font-bold uppercase">{invoice.state.status === "void" ? "Faktur (VOID)" : "Faktur penjualan"}</h1>
              <div className="text-[12pt] font-semibold tabular-nums">{invoice.number}</div>
              <dl className="mt-1 grid grid-cols-[auto_auto] justify-end gap-x-3">
                <dt>Tanggal</dt>
                <dd className="tabular-nums">{formatDate(invoice.date)}</dd>
                <dt>Jatuh tempo</dt>
                <dd className="tabular-nums">{formatDate(invoice.dueDate)}</dd>
              </dl>
            </div>
          </header>
          <section>
            <div className="text-[9pt]">Kepada</div>
            <div className="font-semibold">{invoice.customer.name}</div>
            {invoice.customer.address && <div>{invoice.customer.address}</div>}
            {invoice.customer.phone && <div>{invoice.customer.phone}</div>}
          </section>
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
                    {line.note && <div className="text-[9pt]">{line.note}</div>}
                  </td>
                  <td className={cx(cell, "text-right whitespace-nowrap tabular-nums")}>
                    {line.qty} {line.unit}
                  </td>
                  <td className={cx(cell, "text-right whitespace-nowrap tabular-nums")}>{money(line.unitPrice)}</td>
                  <td className={cx(cell, "text-right whitespace-nowrap tabular-nums")}>{line.discountAmount ? money(line.discountAmount) : "—"}</td>
                  <td className={cx(cell, "text-right whitespace-nowrap tabular-nums")}>{money(line.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-start justify-between gap-8 break-inside-avoid">
            <div className="text-[12pt] whitespace-pre-line" data-testid="faktur-bank">
              {shop?.invoiceBankText}
            </div>
            <dl className="grid min-w-60 shrink-0 grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 tabular-nums">
              <dt>Subtotal</dt>
              <dd className="text-right">{money(invoice.subtotal)}</dd>
              {invoice.discountAmount > 0 && (
                <>
                  <dt>Diskon</dt>
                  <dd className="text-right">− {money(invoice.discountAmount)}</dd>
                </>
              )}
              <dt className="border-t border-black pt-1 font-bold">Total</dt>
              <dd className="border-t border-black pt-1 text-right font-bold">{money(invoice.total)}</dd>
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
          <footer className="grid grid-cols-2 gap-10 break-inside-avoid text-center">
            {(
              [
                ["Penerima", undefined],
                ["Hormat kami", shop?.invoiceSigner || undefined],
              ] as const
            ).map(([role, name]) => (
              <div key={role} className="flex flex-col items-center gap-10">
                <span>{role}</span>
                <span className="min-w-48 border-t border-black pt-1">{name ?? "\u00a0"}</span>
              </div>
            ))}
          </footer>
          <p className="text-[9pt] font-bold">{RETURN_POLICY}</p>
        </>
      )}
    </PrintPage>
  );
}

/** Delivery note: what left the shop, no prices. Number `SO-…` becomes `SJ-…`. */
export function DeliveryNotePrintPage() {
  const { data: invoice, error } = usePrintedInvoice();
  const { data: shop } = useQuery(settingsQuery);
  if (error) return <EmptyState title={error.message} />;
  if (!invoice) return null;
  return (
    <PrintLayout
      title="Surat Jalan"
      numberLabel="NO Surat Jalan"
      number={invoice.number.replace(/^SO-/, "SJ-")}
      date={formatDate(invoice.date)}
      meta={partyMeta("Kepada", invoice.customer)}
    >
      <table className={t.table}>
        <thead>
          <tr>
            <th className={cx(t.th, "py-0")}>Nama Barang</th>
            <th className={cx(t.th, "py-0")}>Ket</th>
            <th className={cx(t.th, "py-0")}>Qty</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id} className="break-inside-avoid">
              <td className={t.td}>
                {line.productName} {line.variant}
              </td>
              <td className={t.td}>{line.note}</td>
              <td className={t.td}>
                {line.qty} {line.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Signatures roles={[["Penerima"], ["Hormat Kami", shop?.invoiceSigner]]} />
      <p className="font-bold">{RETURN_POLICY}</p>
    </PrintLayout>
  );
}
