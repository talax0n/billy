import { formatDate } from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { EmptyState } from "../../components/ui/page.tsx";
import { settingsQuery } from "../../lib/settings.ts";
import { cx } from "../../lib/cx.ts";
import { amount, PrintLayout, partyMeta, printTable as t, RETURN_POLICY, Signatures } from "../print/print-layout.tsx";
import { invoiceQuery } from "./queries.ts";

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
      title={invoice.state.status === "void" ? "Faktur (VOID)" : "Faktur"}
      numberLabel="NO Faktur"
      number={invoice.number}
      date={formatDate(invoice.date)}
      meta={partyMeta("Kepada", invoice.customer)}
    >
      <table className={t.table}>
        <thead>
          <tr>
            <th className={t.th}>Nama Barang</th>
            <th className={t.th}>Ket</th>
            <th className={t.th}>Qty</th>
            <th className={t.th}>Harga Satuan</th>
            <th className={t.th}>Diskon</th>
            <th className={t.th}>Subtotal</th>
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
              <td className={cx(t.td, "text-right")}>{amount(line.unitPrice)}</td>
              <td className={cx(t.td, "text-right")}>{amount(line.discountAmount)}</td>
              <td className={cx(t.td, "text-right")}>{amount(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="break-inside-avoid">
          <tr>
            <td colSpan={4} rowSpan={2} className={cx(t.td, "align-bottom text-[13pt] whitespace-pre-line")}>
              {shop?.invoiceBankText}
            </td>
            <td className="border-l border-black px-1 text-right text-[10pt]">Diskon</td>
            <td className="border-r border-black px-1 text-right">Rp. {amount(invoice.discountAmount)}</td>
          </tr>
          <tr>
            <td className="border-b border-l border-black px-1 text-right text-[10pt]">Total</td>
            <td className="border-r border-b border-black px-1 text-right">Rp. {amount(invoice.total)}</td>
          </tr>
        </tfoot>
      </table>
      <Signatures roles={[["Penerima"], ["Hormat Kami", shop?.invoiceSigner]]} />
      <p className="font-bold">{RETURN_POLICY}</p>
    </PrintLayout>
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
