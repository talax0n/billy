import { businessDate, type DueBucket, formatDate, formatRupiah, rupiah } from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { InferResponseType } from "hono/client";
import { useState } from "react";
import { Badge, StatusTag } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Sheet } from "../../components/ui/dialog.tsx";
import { Amount, EmptyState, FilterRow, Loading, PageBody, PageHeader, StatTile } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { type PayableInvoice, PaymentDialog } from "../purchases/payment-dialog.tsx";

type PayablesList = InferResponseType<typeof api.purchases.payables.$get, 200>;
type SupplierRow = PayablesList["rows"][number];

const bucketLabels: Record<DueBucket, string> = {
  late: "Telat",
  within7: "Jatuh tempo ≤7 hari",
  within30: "8–30 hari",
  later: ">30 hari",
};
const bucketTone = { within7: "warn", within30: "neutral", later: "neutral" } as const;

const money = (value: number, className?: string) =>
  value ? <span className={className}>{formatRupiah(rupiah(value), { symbol: false })}</span> : <span className="text-faint">—</span>;

/** Hutang: what the shop owes each supplier and when, to plan which bills to pay first. */
export function PayablesPage() {
  const paged = usePagedQuery(["purchases", "payables"], (params) =>
    unwrap(api.purchases.payables.$get({ query: { q: params.q, page: String(params.page), pageSize: String(params.pageSize) } })),
  );
  const data = paged.query.data;
  const totals = data?.totals;
  const asOf = formatDate(data?.asOf ?? businessDate());
  const [supplier, setSupplier] = useState<SupplierRow | null>(null);

  return (
    <>
      <PageHeader title="Hutang" />
      <PageBody>
        <div className="grid grid-cols-5 gap-3.5 max-lg:grid-cols-3 max-md:grid-cols-2 max-md:gap-2 max-md:[&>:last-child:nth-child(odd)]:col-span-2">
          {(Object.keys(bucketLabels) as DueBucket[]).map((bucket) => (
            <StatTile key={bucket} label={bucketLabels[bucket]} value={<Amount value={rupiah(totals?.[bucket] ?? 0)} />} note={`Per ${asOf}`} />
          ))}
          <StatTile label="Total hutang" value={<Amount value={rupiah(totals?.total ?? 0)} />} note={`Semua pemasok, per ${asOf}`} />
        </div>
        <FilterRow aside={paged.query.data && `${paged.query.data.total} pemasok`}>
          <span className="text-muted">Pemasok paling mendesak di atas. Klik untuk melihat fakturnya.</span>
        </FilterRow>
        <DataTable
          paged={paged}
          searchPlaceholder="Cari pemasok…"
          onRowClick={setSupplier}
          empty={<EmptyState title="Tidak ada hutang terbuka" description="Semua faktur pemasok sudah lunas." />}
          columns={[
            { header: "Pemasok", cell: (s) => s.supplierName },
            { header: "Faktur", align: "right", cell: (s) => s.invoiceCount },
            { header: "Jatuh tempo terdekat", cell: (s) => formatDate(s.nextDueDate), className: "whitespace-nowrap" },
            { header: "Telat (Rp)", align: "right", cell: (s) => money(s.late, "text-down") },
            { header: "≤7 hari (Rp)", align: "right", cell: (s) => money(s.within7, "text-warn") },
            { header: "8–30 hari (Rp)", align: "right", cell: (s) => money(s.within30) },
            { header: ">30 hari (Rp)", align: "right", cell: (s) => money(s.later) },
            { header: "Total (Rp)", align: "right", cell: (s) => <span className="font-medium">{formatRupiah(s.total, { symbol: false })}</span> },
          ]}
        />
      </PageBody>
      {supplier && <SupplierPayablesSheet supplier={supplier} onClose={() => setSupplier(null)} />}
    </>
  );
}

function SupplierPayablesSheet({ supplier, onClose }: { supplier: SupplierRow; onClose: () => void }) {
  const invoices = useQuery({
    queryKey: ["purchases", "payables", supplier.id],
    queryFn: () => unwrap(api.purchases.payables[":supplierId"].$get({ param: { supplierId: supplier.id } })),
  });
  const [paying, setPaying] = useState<PayableInvoice | null>(null);
  const rows = invoices.data?.rows ?? [];
  const open = rupiah(rows.reduce((sum, row) => sum + row.outstanding, 0));

  return (
    <Sheet open onClose={onClose} className="max-w-3xl" title={supplier.supplierName} description={`Hutang terbuka ${formatRupiah(open)}`}>
      {invoices.isPending && <Loading />}
      {invoices.data && rows.length === 0 && <EmptyState title="Semua faktur pemasok ini sudah lunas" />}
      <ul className="flex flex-col">
        {rows.map((invoice) => (
          <li key={invoice.id} className="flex items-center gap-4 border-b border-line-2 py-3 last:border-b-0">
            <div className="flex min-w-0 flex-1 flex-col">
              <Link to="/pembelian" search={{ id: invoice.id }} className="font-medium hover:underline">
                {invoice.number}
              </Link>
              <span className="text-xs text-muted">
                {invoice.supplierInvoiceNumber || "Tanpa no. pemasok"} · Jatuh tempo {formatDate(invoice.dueDate)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {invoice.bucket !== "late" && <Badge tone={bucketTone[invoice.bucket]}>{bucketLabels[invoice.bucket]}</Badge>}
              <StatusTag state={invoice} />
            </div>
            <span className="w-32 text-right tabular-nums">{formatRupiah(invoice.outstanding)}</span>
            <Button size="sm" onClick={() => setPaying(invoice)}>
              Bayar
            </Button>
          </li>
        ))}
      </ul>
      <PaymentDialog invoice={paying} onClose={() => setPaying(null)} />
    </Sheet>
  );
}
