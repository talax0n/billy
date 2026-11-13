import { businessDate, formatRupiah, type Rupiah, roleLabels } from "@billy/core";
import { useState } from "react";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { DateInput } from "../../components/ui/field.tsx";
import { EmptyState, FilterRow, PageBody, PageHeader } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";
import { FlagItem } from "./flags.tsx";

const signedMoney = (value: Rupiah) => (value === 0 ? "—" : `${value > 0 ? "+" : ""}${formatRupiah(value)}`);
const countAndAmount = (n: number, amount: Rupiah) => (n === 0 ? "—" : `${n}× · ${formatRupiah(amount)}`);

/**
 * Ringkasan harian, admin only: the day's red flags, then per person the voids, revisi,
 * refunds, discounts given and shift cash differences. It replaces a daily email.
 */
export function DailySummaryPage() {
  const [date, setDate] = useState(businessDate());
  const paged = usePagedQuery(["watchdog", "daily", date], () => unwrap(api.watchdog.daily.$get({ query: { date } })), 100);
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
          empty={<EmptyState title="Tidak ada void, revisi, diskon atau shift" />}
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
            { header: "Void", align: "right", cell: (r) => countAndAmount(r.voids, r.voidAmount) },
            { header: "Revisi", align: "right", cell: (r) => (r.revisi ? `${r.revisi}×` : "—") },
            { header: "Refund", align: "right", cell: (r) => countAndAmount(r.refunds, r.refundAmount) },
            { header: "Diskon", align: "right", cell: (r) => (r.discountAmount ? formatRupiah(r.discountAmount) : "—") },
            {
              header: "Selisih shift",
              align: "right",
              cell: (r) => (
                <span className={cx("tabular-nums", r.shiftDifference < 0 && "text-down", r.shiftDifference > 0 && "text-warn")}>
                  {r.shifts ? signedMoney(r.shiftDifference) : "—"}
                </span>
              ),
            },
          ]}
        />
      </PageBody>
    </>
  );
}
