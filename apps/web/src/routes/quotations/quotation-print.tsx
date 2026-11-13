import { formatDate, formatRupiah, rupiah } from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { EmptyState } from "../../components/ui/page.tsx";
import { cx } from "../../lib/cx.ts";
import { PartyBlock, PrintLayout, printTable as t, Signatures } from "../print/print-layout.tsx";
import { quotationQuery } from "./queries.ts";

const money = (value: number) => formatRupiah(rupiah(value));

export function QuotationPrintPage() {
  const { id } = useParams({ strict: false });
  const { data: quotation, error } = useQuery({ ...quotationQuery(id ?? ""), enabled: Boolean(id) });
  if (error) return <EmptyState title={error.message} />;
  if (!quotation) return null;
  return (
    <PrintLayout
      title="PENAWARAN HARGA"
      number={quotation.number}
      meta={[
        ["Tanggal", formatDate(quotation.date)],
        ["Berlaku sampai", formatDate(quotation.validUntil)],
      ]}
    >
      <PartyBlock label="Kepada" party={quotation.customer} />
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
          {quotation.lines.map((line, i) => (
            <tr key={i} className="break-inside-avoid">
              <td className={cx(t.td, "tabular-nums")}>{i + 1}</td>
              <td className={t.td}>
                {line.productName} {line.variant}
                {line.note && <div className="text-xs text-ink-2">{line.note}</div>}
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
          {quotation.note && <p>Catatan: {quotation.note}</p>}
          <p className="mt-1 font-medium text-ink">Bukan tagihan</p>
        </div>
        <dl className="grid min-w-56 grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 tabular-nums">
          <dt>Subtotal</dt>
          <dd className="text-right">{money(quotation.subtotal)}</dd>
          {quotation.discountAmount > 0 && (
            <>
              <dt>Diskon</dt>
              <dd className="text-right">− {money(quotation.discountAmount)}</dd>
            </>
          )}
          <dt className="border-t border-ink pt-1 font-semibold">Total</dt>
          <dd className="border-t border-ink pt-1 text-right font-semibold">{money(quotation.total)}</dd>
        </dl>
      </div>
      <Signatures roles={[["Pelanggan"], ["Hormat kami"]]} />
    </PrintLayout>
  );
}
