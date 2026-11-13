import { type CashSourceType, cashSourceTypeLabels, cashSourceTypes, formatDate, formatRupiah, rupiah } from "@billy/core";
import { Link } from "@tanstack/react-router";
import type { InferResponseType } from "hono/client";
import { useState } from "react";
import { ExportButton } from "../../components/export-button.tsx";
import { type Period, PeriodFilter, periodLabel, presetPeriod } from "../../components/period-filter.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Select } from "../../components/ui/field.tsx";
import { EmptyState, FilterRow, PageBody, PageHeader, StatTile } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { AccountSelect } from "../cash/account-select.tsx";

/** Where the document behind an entry opens; a transfer or a manual entry has none. */
const documentPages: Partial<Record<CashSourceType, string>> = {
  sales_payment: "/penjualan",
  purchase_payment: "/pembelian",
  pos_sale: "/riwayat-kasir",
  expense: "/biaya",
};

const money = (value: number) => formatRupiah(rupiah(value));

type ReportPage = InferResponseType<typeof api.cash.report.$get, 200>;
const noPeriod: ReportPage = { rows: [], total: 0, totalIn: rupiah(0), totalOut: rupiah(0), opening: null, closing: null };

/**
 * Laporan Kas (legacy "Laporan Debit Kredit"): every cash and bank movement of a period, oldest
 * first. Pick one account to see its opening balance and the balance after each row.
 */
export function CashReportPage() {
  const [period, setPeriod] = useState<Period>(() => presetPeriod("month"));
  const [accountId, setAccountId] = useState("");
  const [sourceType, setSourceType] = useState<CashSourceType | "">("");
  const ready = Boolean(period.from && period.to);
  const filters = { from: period.from, to: period.to, ...(accountId && { accountId }), ...(sourceType && { sourceType }) };

  const paged = usePagedQuery(["cash-report", filters], (params) =>
    ready
      ? unwrap(api.cash.report.$get({ query: { ...filters, q: params.q, page: String(params.page), pageSize: String(params.pageSize) } }))
      : Promise.resolve(noPeriod),
  );
  const filter = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    paged.setPage(1);
  };
  const data = paged.query.data;
  const oneAccount = data?.opening !== null && data?.opening !== undefined;

  return (
    <>
      <PageHeader
        title="Laporan Kas"
        actions={<ExportButton disabled={!ready} path={`/api/cash/report.xlsx?${new URLSearchParams({ ...filters, ...(paged.q && { q: paged.q }) })}`} />}
      />
      <PageBody>
        <FilterRow aside={ready ? periodLabel(period) : "Pilih tanggal awal dan akhir"}>
          <PeriodFilter bounded value={period} onChange={filter(setPeriod)} />
          <div className="w-48">
            <AccountSelect id="cash-report-account" aria-label="Akun" value={accountId} placeholder="Semua akun" onChange={filter(setAccountId)} />
          </div>
          <Select
            className="w-52"
            aria-label="Sumber"
            value={sourceType}
            onChange={(e) => filter(setSourceType)(e.target.value as CashSourceType | "")}
          >
            <option value="">Semua sumber</option>
            {cashSourceTypes.map((type) => (
              <option key={type} value={type}>
                {cashSourceTypeLabels[type]}
              </option>
            ))}
          </Select>
        </FilterRow>

        <div className="grid grid-cols-4 gap-3.5 max-lg:grid-cols-2 max-md:gap-2">
          <StatTile label="Masuk" value={<span className="text-up">{money(data?.totalIn ?? 0)}</span>} note={`${data?.total ?? 0} baris sesuai filter`} />
          <StatTile label="Keluar" value={<span className="text-down">{money(data?.totalOut ?? 0)}</span>} note="Sesuai filter" />
          {oneAccount && (
            <>
              <StatTile label="Saldo awal" value={money(data.opening!)} note={`Sebelum ${formatDate(period.from)}`} />
              <StatTile label="Saldo akhir" value={money(data.closing!)} note={`Per ${formatDate(period.to)}, semua sumber`} />
            </>
          )}
        </div>

        <DataTable
          paged={paged}
          searchPlaceholder="Cari keterangan…"
          empty={<EmptyState title={ready ? "Tidak ada uang masuk atau keluar di periode ini" : "Pilih tanggal awal dan akhir"} />}
          columns={[
            { header: "Tanggal", cell: (r) => formatDate(r.date), className: "whitespace-nowrap" },
            { header: "Akun", cell: (r) => r.accountName },
            { header: "Sumber", cell: (r) => <span className="text-ink-2">{cashSourceTypeLabels[r.sourceType]}</span> },
            {
              header: "Dokumen",
              cell: (r) => {
                const page = documentPages[r.sourceType];
                if (!r.documentNumber) return <span className="text-faint">—</span>;
                return page && r.documentId ? (
                  <Link to={page} search={{ id: r.documentId }} className="underline hover:text-ink">
                    {r.documentNumber}
                  </Link>
                ) : (
                  r.documentNumber
                );
              },
              className: "whitespace-nowrap",
            },
            { header: "Keterangan", cell: (r) => <span className="text-ink-2">{r.note || "—"}</span> },
            { header: "Masuk", align: "right", cell: (r) => (r.direction === "in" ? money(r.amount) : "") },
            { header: "Keluar", align: "right", cell: (r) => (r.direction === "out" ? money(r.amount) : "") },
            ...(oneAccount ? [{ header: "Saldo", align: "right" as const, cell: (r: { balance: number | null }) => (r.balance === null ? "" : money(r.balance)) }] : []),
          ]}
        />
      </PageBody>
    </>
  );
}
