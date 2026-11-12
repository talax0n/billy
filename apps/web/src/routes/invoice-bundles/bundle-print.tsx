import { formatDate, formatRupiah, rupiah } from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { EmptyState } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";
import { PartyBlock, PrintLayout, printTable as t, Signatures } from "../print/print-layout.tsx";

const money = (value: number) => formatRupiah(rupiah(value));

export function BundlePrintPage() {
  const { id } = useParams({ strict: false });
  const { data: bundle, error } = useQuery({
    queryKey: ["invoice-bundles", id],
    queryFn: () => unwrap(api["invoice-bundles"][":id"].$get({ param: { id: id! } })),
    enabled: Boolean(id),
  });
  if (error) return <EmptyState title={error.message} />;
  if (!bundle) return null;
  return (
    <PrintLayout
      title={bundle.voidedAt ? "Tukar faktur (VOID)" : "Tanda terima tukar faktur"}
      number={bundle.number}
      meta={[["Tanggal", formatDate(bundle.date)]]}
    >
      <PartyBlock label="Pelanggan" party={bundle.customer} />
      <table className={t.table}>
        <thead>
          <tr>
            <th className={cx(t.th, "w-6")}>No</th>
            <th className={t.th}>Faktur</th>
            <th className={t.th}>Tanggal</th>
            <th className={t.th}>Jatuh tempo</th>
            <th className={cx(t.th, "text-right")}>Total</th>
            <th className={cx(t.th, "text-right")}>Sisa tagihan</th>
          </tr>
        </thead>
        <tbody>
          {bundle.invoices.map((inv, i) => (
            <tr key={inv.id} className="break-inside-avoid">
              <td className={cx(t.td, "tabular-nums")}>{i + 1}</td>
              <td className={t.td}>{inv.number}</td>
              <td className={cx(t.td, "tabular-nums")}>{formatDate(inv.date)}</td>
              <td className={cx(t.td, "tabular-nums")}>{formatDate(inv.dueDate)}</td>
              <td className={cx(t.td, "text-right tabular-nums")}>{money(inv.total)}</td>
              <td className={cx(t.td, "text-right tabular-nums")}>{money(inv.state.outstanding)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td colSpan={5} className="px-1.5 py-1 text-right">
              Jumlah tagihan
            </td>
            <td className="px-1.5 py-1 text-right tabular-nums">{money(bundle.outstanding)}</td>
          </tr>
        </tfoot>
      </table>
      {bundle.note && <p className="text-ink-2">Catatan: {bundle.note}</p>}
      <Signatures roles={[["Yang menerima"], ["Yang menyerahkan"]]} />
    </PrintLayout>
  );
}
