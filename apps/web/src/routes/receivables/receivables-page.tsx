import { agingBuckets, agingLabels, formatDate, formatRupiah, rupiah } from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { ExportButton } from "../../components/export-button.tsx";
import { StatusTag } from "../../components/ui/badge.tsx";
import { Sheet } from "../../components/ui/dialog.tsx";
import { EmptyState, Loading, PageBody, PageHeader, StatTile } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";
import { BulkPaymentDialog } from "./bulk-payment-dialog.tsx";
import { InvoiceSheet } from "../sales/invoice-sheet.tsx";

const money = (value: number) => (value ? formatRupiah(rupiah(value)) : "—");
const amount = (value: number) => (value ? formatRupiah(rupiah(value), { symbol: false }) : "—");

/** Piutang: what each customer still owes, aged by days past due. */
export function ReceivablesPage() {
  const receivables = useQuery({ queryKey: ["sales", "receivables"], queryFn: () => unwrap(api.sales.receivables.$get()) });
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const data = receivables.data;
  const asOf = data ? `Per ${formatDate(data.asOf)}` : "";

  return (
    <>
      <PageHeader title="Piutang" actions={<ExportButton path="/api/sales/receivables.xlsx" disabled={!data?.rows.length} />} />
      <PageBody>
        <div className="grid grid-cols-3 gap-3.5 max-md:grid-cols-2 max-md:gap-2 max-md:[&>:last-child:nth-child(odd)]:col-span-2">
          <StatTile label="Total piutang" value={formatRupiah(rupiah(data?.totals?.total ?? 0))} note={`${asOf} · semua faktur belum lunas`} />
          <StatTile label="Belum jatuh tempo" value={formatRupiah(rupiah(data?.totals?.current ?? 0))} note={asOf} />
          <StatTile
            label="Lewat jatuh tempo"
            value={
              <span className="text-down">
                {formatRupiah(rupiah((data?.totals?.total ?? 0) - (data?.totals?.current ?? 0)))}
              </span>
            }
            note={`${asOf} · ${data?.rows.filter((r) => r.total > r.current).length ?? 0} pelanggan`}
          />
        </div>
        <div className="overflow-x-auto rounded-xl border border-line">
          <ul className="md:hidden">
            {data?.rows.map((row) => (
              <li
                key={row.id}
                onClick={() => setCustomer({ id: row.id, name: row.customerName })}
                className="cursor-pointer border-b border-line-2 px-4 py-3 last:border-b-0 active:bg-line-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{row.customerName}</div>
                    <div className="text-xs text-muted">{row.invoiceCount} faktur</div>
                  </div>
                  <div className="shrink-0 font-medium tabular-nums">{money(row.total)}</div>
                </div>
                <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
                  {agingBuckets
                    .filter((b) => row[b] > 0)
                    .map((b) => (
                      <div key={b} className="contents">
                        <dt className="text-muted">{agingLabels[b]}</dt>
                        <dd className={cx("text-right tabular-nums", b !== "current" && "text-down")}>{money(row[b])}</dd>
                      </div>
                    ))}
                </dl>
              </li>
            ))}
          </ul>
          <table className="w-full min-w-[640px] border-collapse max-md:hidden">
            <thead className="sticky top-0 bg-panel">
              <tr className="border-b border-line text-xs text-muted">
                <th className="px-4 py-2.5 text-left font-normal">Pelanggan</th>
                <th className="px-4 py-2.5 text-right font-normal">Faktur</th>
                {agingBuckets.map((b) => (
                  <th key={b} className="px-4 py-2.5 text-right font-normal">
                    {agingLabels[b]} (Rp)
                  </th>
                ))}
                <th className="px-4 py-2.5 text-right font-normal">Total (Rp)</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setCustomer({ id: row.id, name: row.customerName })}
                  className="cursor-pointer border-b border-line-2 last:border-b-0 hover:bg-line-2"
                >
                  <td className="px-4 py-2.5">{row.customerName}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.invoiceCount}</td>
                  {agingBuckets.map((b) => (
                    <td key={b} className={cx("px-4 py-2.5 text-right tabular-nums", b !== "current" && row[b] > 0 && "text-down")}>
                      {amount(row[b])}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{amount(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {receivables.isPending && <Loading />}
          {receivables.isError && <p className="px-4 py-10 text-center text-down">{receivables.error.message}</p>}
          {data?.rows.length === 0 && <EmptyState title="Tidak ada piutang" description="Semua faktur sudah lunas." />}
        </div>
      </PageBody>
      {customer && <CustomerInvoicesSheet customer={customer} onClose={() => setCustomer(null)} />}
    </>
  );
}

function CustomerInvoicesSheet({ customer, onClose }: { customer: { id: string; name: string }; onClose: () => void }) {
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState(false);
  const invoices = useQuery({
    queryKey: ["sales", "list", "open", customer.id],
    queryFn: () => unwrap(api.sales.$get({ query: { customerId: customer.id, status: "open", pageSize: "100" } })),
  });
  const rows = invoices.data?.rows ?? [];
  const chosen = rows.filter((inv) => picked.has(inv.id));
  const chosenTotal = chosen.reduce((sum, inv) => sum + inv.state.outstanding, 0);
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  if (invoiceId) return <InvoiceSheet invoiceId={invoiceId} onOpenInvoice={setInvoiceId} onClose={() => setInvoiceId(null)} />;
  if (paying) {
    return (
      <BulkPaymentDialog
        customerName={customer.name}
        invoices={chosen.map((inv) => ({ id: inv.id, number: inv.number, date: inv.date, dueDate: inv.dueDate, outstanding: rupiah(inv.state.outstanding) }))}
        onClose={() => {
          setPaying(false);
          setPicked(new Set());
        }}
      />
    );
  }
  return (
    <Sheet open onClose={onClose} title={customer.name} description="Faktur belum lunas · centang untuk bayar sekaligus">
      <ul className="flex flex-col">
        {rows.map((inv) => (
          <li key={inv.id} className="flex items-center gap-3 border-b border-line-2">
            <input
              type="checkbox"
              aria-label={`Pilih ${inv.number}`}
              className="size-4 shrink-0 accent-ink"
              checked={picked.has(inv.id)}
              onChange={() => toggle(inv.id)}
            />
            <button type="button" onClick={() => setInvoiceId(inv.id)} className="flex flex-1 items-center gap-3 py-2.5 text-left hover:bg-line-2">
              <div className="flex-1">
                <div className="font-medium">{inv.number}</div>
                <div className={cx("text-xs", inv.state.overdue ? "text-down" : "text-muted")}>
                  {formatDate(inv.date)} · jatuh tempo {formatDate(inv.dueDate)}
                </div>
              </div>
              <StatusTag state={inv.state} />
              <span className="w-32 text-right tabular-nums">{formatRupiah(rupiah(inv.state.outstanding))}</span>
            </button>
          </li>
        ))}
      </ul>
      {rows.length > 0 && (
        <div className="sticky bottom-0 mt-4 flex items-center gap-3 border-t border-line bg-panel pt-3">
          <button type="button" className="text-sm text-muted underline" onClick={() => setPicked(picked.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))}>
            {picked.size === rows.length ? "Batal pilih" : "Pilih semua"}
          </button>
          <Button variant="primary" className="ml-auto" disabled={chosen.length === 0} onClick={() => setPaying(true)}>
            {chosen.length === 0 ? "Bayar" : `Bayar ${chosen.length} faktur · ${formatRupiah(rupiah(chosenTotal))}`}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
