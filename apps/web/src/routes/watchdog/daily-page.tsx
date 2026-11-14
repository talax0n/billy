import { businessDate, formatRupiah, type Rupiah, roleLabels } from "@billy/core";
import { useState } from "react";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { DateInput } from "../../components/ui/field.tsx";
import { EmptyState, FilterRow, PageBody, PageHeader } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { FlagItem } from "./flags.tsx";

const countAndAmount = (n: number, amount: Rupiah) => (n === 0 ? "—" : `${n}× · ${formatRupiah(amount, { symbol: false })}`);

/**
 * Ringkasan harian, admin only: the day's red flags, then per person the voids, revisi,
 * refunds and discounts given. It replaces a daily email.
 */
export function DailySummaryPage() {
  const [date, setDate] = useState(businessDate());
  const paged = usePagedQuery(["watchdog", "daily", date], () => unwrap(api.watchdog.daily.$get({ query: { date } })), { pageSize: 100 });
  const flags = paged.query.data?.flags ?? [];

  return (
    <>
      <PageHeader title="Ringkasan harian" />
      <PageBody>
        <FilterRow aside={paged.query.data && `${flags.length} peringatan`}>
          <DateInput aria-label="Tanggal" className="w-44" value={date} max={businessDate()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </FilterRow>
        <section aria-label="Peringatan" className="overflow-hidden rounded-xl border border-line">
          <h2 className="border-b border-line px-4 py-2.5 text-sm font-medium">Peringatan</h2>
          {flags.length ? (
            <ul>
              {flags.map((flag) => (
                <li key={flag.id} className="border-b border-line-2 last:border-b-0">
                  <FlagItem flag={flag} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-center text-muted">{paged.query.isPending ? "Memuat…" : "Tidak ada peringatan pada tanggal ini."}</p>
          )}
        </section>
        <h2 className="text-sm font-medium">Per orang</h2>
        <DataTable
          paged={paged}
          search={false}
          empty={<EmptyState title="Tidak ada pembatalan, revisi atau diskon" />}
          columns={[
            {
              header: "Orang",
              cell: (r) => (
                <span>
                  {r.name}
                  <small className="block font-normal text-muted">{roleLabels[r.role]}</small>
                </span>
              ),
            },
            { header: "Pembatalan (Rp)", align: "right", cell: (r) => countAndAmount(r.voids, r.voidAmount) },
            { header: "Revisi", align: "right", cell: (r) => (r.revisi ? `${r.revisi}×` : "—") },
            { header: "Refund (Rp)", align: "right", cell: (r) => countAndAmount(r.refunds, r.refundAmount) },
            { header: "Diskon (Rp)", align: "right", cell: (r) => (r.discountAmount ? formatRupiah(r.discountAmount, { symbol: false }) : "—") },
          ]}
        />
      </PageBody>
    </>
  );
}
