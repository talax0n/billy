import { formatRupiah, roleLabels, type Rupiah } from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { type Period, PeriodFilter, periodQuery, presetPeriod } from "../../components/period-filter.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Select } from "../../components/ui/field.tsx";
import { EmptyState, FilterRow, PageBody, PageHeader } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";

const time = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
const money = (value: Rupiah | null) => (value === null ? "—" : formatRupiah(value));

/**
 * Laporan Shift, admin only: every Kasir shift with its opening float, the cash the server
 * expected at close, what the cashier counted, and the difference. A shortfall shows in red.
 */
export function ShiftsPage() {
  const search: ShiftSearch = useSearch({ strict: false });
  return <ShiftReport key={JSON.stringify(search)} search={search} />;
}

/** Filters a watchdog flag opens the report with. */
interface ShiftSearch {
  cashierId?: string;
  from?: string;
  to?: string;
}

function ShiftReport({ search }: { search: ShiftSearch }) {
  const [period, setPeriod] = useState<Period>(() =>
    search.from ? { preset: "custom", from: search.from, to: search.to ?? "" } : presetPeriod("last30"),
  );
  const [cashierId, setCashierId] = useState(search.cashierId ?? "");
  const people = useQuery({ queryKey: ["users", "all"], queryFn: () => unwrap(api.users.$get({ query: { pageSize: "100" } })) });
  const paged = usePagedQuery(["shifts", period, cashierId], (params) =>
    unwrap(
      api.shifts.$get({
        query: { page: String(params.page), pageSize: String(params.pageSize), ...periodQuery(period), ...(cashierId && { cashierId }) },
      }),
    ),
  );
  const filter = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    paged.setPage(1);
  };

  return (
    <>
      <PageHeader title="Laporan Shift" />
      <PageBody>
        <FilterRow aside={paged.query.data && `${paged.query.data.total} shift`}>
          <PeriodFilter value={period} onChange={filter(setPeriod)} />
          <Select className="w-44" aria-label="Kasir" value={cashierId} onChange={(e) => filter(setCashierId)(e.target.value)}>
            <option value="">Semua kasir</option>
            {people.data?.rows.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({roleLabels[u.role]})
              </option>
            ))}
          </Select>
        </FilterRow>
        <DataTable
          paged={paged}
          empty={<EmptyState title="Belum ada shift" description="Ubah filter atau periode." />}
          columns={[
            {
              header: "Kasir",
              cell: (r) => (
                <span>
                  {r.cashierName}
                  <small className="block text-muted">
                    {r.deviceCode} · {r.accountName}
                  </small>
                </span>
              ),
            },
            {
              header: "Waktu",
              className: "whitespace-nowrap",
              cell: (r) => (
                <span className="tabular-nums text-ink-2">
                  {time.format(new Date(r.openedAt))} – {r.closedAt ? time.format(new Date(r.closedAt)) : <Badge tone="warn">Terbuka</Badge>}
                </span>
              ),
            },
            { header: "Modal", align: "right", mobile: false, cell: (r) => <span className="tabular-nums">{money(r.openingFloat)}</span> },
            { header: "Seharusnya", align: "right", cell: (r) => <span className="tabular-nums">{money(r.expectedCash)}</span> },
            { header: "Dihitung", align: "right", cell: (r) => <span className="tabular-nums">{money(r.countedCash)}</span> },
            {
              header: "Selisih",
              align: "right",
              cell: (r) => (
                <span className={cx("tabular-nums font-medium", r.difference !== null && r.difference < 0 && "text-down", r.difference !== null && r.difference > 0 && "text-warn")}>
                  {r.difference === null ? "—" : `${r.difference > 0 ? "+" : ""}${formatRupiah(r.difference)}`}
                </span>
              ),
            },
            { header: "Catatan", mobile: false, cell: (r) => <span className="text-ink-2">{r.closeNote || "—"}</span> },
          ]}
        />
      </PageBody>
    </>
  );
}
