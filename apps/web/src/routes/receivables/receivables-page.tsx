import { agingBuckets, agingLabels, formatDate, formatRupiah, rupiah } from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { StatusTag } from "../../components/ui/badge.tsx";
import { Sheet } from "../../components/ui/dialog.tsx";
import { EmptyState, PageBody, PageHeader, StatTile } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";
import { InvoiceSheet } from "../sales/invoice-sheet.tsx";

const money = (value: number) => (value ? formatRupiah(rupiah(value)) : "—");

/** Piutang: what each customer still owes, aged by days past due. */
export function ReceivablesPage() {
  const receivables = useQuery({ queryKey: ["sales", "receivables"], queryFn: () => unwrap(api.sales.receivables.$get()) });
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const data = receivables.data;
  const asOf = data ? `Per ${formatDate(data.asOf)}` : "";

  return (
    <>
      <PageHeader title="Piutang" />
      <PageBody>
        <div className="grid grid-cols-3 gap-3.5 max-md:grid-cols-1">
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
          <table className="w-full min-w-[640px] border-collapse">
            <thead className="sticky top-0 bg-panel">
              <tr className="border-b border-line text-xs text-muted">
                <th className="px-4 py-2.5 text-left font-normal">Pelanggan</th>
                <th className="px-4 py-2.5 text-right font-normal">Faktur</th>
                {agingBuckets.map((b) => (
                  <th key={b} className="px-4 py-2.5 text-right font-normal">
                    {agingLabels[b]}
                  </th>
                ))}
                <th className="px-4 py-2.5 text-right font-normal">Total</th>
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
                      {money(row[b])}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{money(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {receivables.isPending && <p className="px-4 py-10 text-center text-muted">Memuat…</p>}
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
  const invoices = useQuery({
    queryKey: ["sales", "list", "open", customer.id],
    queryFn: () => unwrap(api.sales.$get({ query: { customerId: customer.id, status: "open", pageSize: "100" } })),
  });
  if (invoiceId) return <InvoiceSheet invoiceId={invoiceId} onOpenInvoice={setInvoiceId} onClose={() => setInvoiceId(null)} />;
  return (
    <Sheet open onClose={onClose} title={customer.name} description="Faktur belum lunas">
      <ul className="flex flex-col">
        {invoices.data?.rows.map((inv) => (
          <li key={inv.id}>
            <button
              type="button"
              onClick={() => setInvoiceId(inv.id)}
              className="flex w-full items-center gap-3 border-b border-line-2 py-2.5 text-left hover:bg-line-2"
            >
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
    </Sheet>
  );
}
