import { formatDate, formatRupiah, rupiah } from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { EmptyState } from "../../components/ui/page.tsx";
import { settingsQuery } from "../../lib/settings.ts";
import { cx } from "../../lib/cx.ts";
import { PartyBlock, PrintLayout, printTable as t, Signatures } from "../print/print-layout.tsx";
import { invoiceQuery } from "./queries.ts";

const money = (value: number) => formatRupiah(rupiah(value));

function usePrintedInvoice() {
  const { id } = useParams({ strict: false });
  return useQuery({ ...invoiceQuery(id ?? ""), enabled: Boolean(id) });
}

export function InvoicePrintPage() {
  const { data: invoice, error } = usePrintedInvoice();
  const { data: shop } = useQuery(settingsQuery);
  if (error) return <EmptyState title={error.message} />;
  if (!invoice) return null;
  return (
    <PrintLayout
      title={invoice.state.status === "void" ? "Faktur (VOID)" : "Faktur penjualan"}
      number={invoice.number}
      meta={[
        ["Tanggal", formatDate(invoice.date)],
        ["Jatuh tempo", formatDate(invoice.dueDate)],
      ]}
    >
      <PartyBlock label="Kepada" party={invoice.customer} />
      <table className={t.table}>
        <thead>
          <tr>
            <th className={cx(t.th, "w-6")}>No</th>
            <th className={t.th}>Barang</th>
            <th className={cx(t.th, "text-right")}>Jumlah</th>
            <th className={cx(t.th, "text-right")}>Harga</th>
            <th className={cx(t.th, "text-right")}>Diskon</th>
            <th className={cx(t.th, "text-right")}>Total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line, i) => (
            <tr key={line.id} className="break-inside-avoid">
              <td className={cx(t.td, "tabular-nums")}>{i + 1}</td>
              <td className={t.td}>
                {line.productName} {line.variant}
                {line.note && <div className="text-[11px] text-ink-2">{line.note}</div>}
              </td>
              <td className={cx(t.td, "text-right whitespace-nowrap tabular-nums")}>
                {line.qty} {line.unit}
              </td>
              <td className={cx(t.td, "text-right tabular-nums")}>{money(line.unitPrice)}</td>
              <td className={cx(t.td, "text-right tabular-nums")}>{line.discountAmount ? money(line.discountAmount) : "—"}</td>
              <td className={cx(t.td, "text-right tabular-nums")}>{money(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-start justify-between gap-8 break-inside-avoid">
        <div className="max-w-[55%] text-ink-2">
          {invoice.note && <p>Catatan: {invoice.note}</p>}
          {shop?.invoiceBankText && (
            <p className="mt-1 whitespace-pre-line">
              Pembayaran ke: <span className="text-ink">{shop.invoiceBankText}</span>
            </p>
          )}
        </div>
        <dl className="grid min-w-56 grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 tabular-nums">
          <dt>Subtotal</dt>
          <dd className="text-right">{money(invoice.subtotal)}</dd>
          {invoice.discountAmount > 0 && (
            <>
              <dt>Diskon</dt>
              <dd className="text-right">− {money(invoice.discountAmount)}</dd>
            </>
          )}
          <dt className="border-t border-ink pt-1 font-semibold">Total</dt>
          <dd className="border-t border-ink pt-1 text-right font-semibold">{money(invoice.total)}</dd>
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
      <Signatures roles={[["Penerima"], ["Hormat kami", shop?.invoiceSigner || undefined]]} />
    </PrintLayout>
  );
}

/** Delivery note: what left the shop, no prices. Number `SO-…` becomes `SJ-…`. */
export function DeliveryNotePrintPage() {
  const { data: invoice, error } = usePrintedInvoice();
  if (error) return <EmptyState title={error.message} />;
  if (!invoice) return null;
  return (
    <PrintLayout
      title="Surat jalan"
      number={invoice.number.replace(/^SO-/, "SJ-")}
      meta={[
        ["Tanggal", formatDate(invoice.date)],
        ["Faktur", invoice.number],
      ]}
    >
      <PartyBlock label="Dikirim ke" party={invoice.customer} />
      <table className={t.table}>
        <thead>
          <tr>
            <th className={cx(t.th, "w-6")}>No</th>
            <th className={t.th}>Barang</th>
            <th className={cx(t.th, "text-right")}>Jumlah</th>
            <th className={t.th}>Satuan</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line, i) => (
            <tr key={line.id} className="break-inside-avoid">
              <td className={cx(t.td, "tabular-nums")}>{i + 1}</td>
              <td className={t.td}>
                {line.productName} {line.variant}
                {line.note && <div className="text-[11px] text-ink-2">{line.note}</div>}
              </td>
              <td className={cx(t.td, "text-right tabular-nums")}>{line.qty}</td>
              <td className={t.td}>{line.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-ink-2">Barang diterima dalam keadaan baik dan cukup.</p>
      <Signatures roles={[["Penerima"], ["Pengirim"]]} />
    </PrintLayout>
  );
}
