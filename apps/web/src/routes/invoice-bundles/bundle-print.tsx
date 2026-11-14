import { formatDate, terbilang } from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { EmptyState } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";
import { settingsQuery } from "../../lib/settings.ts";
import { amount, PrintLayout, partyMeta, printTable as t, Signatures } from "../print/print-layout.tsx";

export function BundlePrintPage() {
  const { id } = useParams({ strict: false });
  const { data: bundle, error } = useQuery({
    queryKey: ["invoice-bundles", id],
    queryFn: () => unwrap(api["invoice-bundles"][":id"].$get({ param: { id: id! } })),
    enabled: Boolean(id),
  });
  const { data: shop } = useQuery(settingsQuery);
  if (error) return <EmptyState title={error.message} />;
  if (!bundle) return null;
  return (
    <PrintLayout
      title={bundle.voidedAt ? "Tanda Terima (VOID)" : "Tanda Terima"}
      numberLabel="NO"
      number={bundle.number}
      date={formatDate(bundle.date)}
      meta={partyMeta("Kepada", bundle.customer)}
    >
      <table className={t.table}>
        <thead>
          <tr>
            <th className={t.th}>NO Faktur</th>
            <th className={t.th}>Tanggal</th>
            <th className={t.th}>Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {bundle.invoices.map((inv) => (
            <tr key={inv.id} className="break-inside-avoid">
              <td className={t.td}>{inv.number}</td>
              <td className={cx(t.td, "text-center")}>{formatDate(inv.date)}</td>
              <td className={cx(t.td, "text-right")}>Rp. {amount(inv.state.outstanding)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} className={cx(t.td, "text-right text-[10pt]")}>
              Total
            </td>
            <td className={cx(t.td, "text-right")}>Rp. {amount(bundle.outstanding)}</td>
          </tr>
        </tfoot>
      </table>
      <div className="break-inside-avoid">
        <div className="font-bold">Terbilang</div>
        <div className="text-[13pt] font-bold italic">{terbilang(bundle.outstanding)}</div>
      </div>
      <Signatures roles={[["Penerima"], ["Hormat Kami", shop?.invoiceSigner]]} />
    </PrintLayout>
  );
}
