import { formatDate, formatRupiah, type PurchaseSortKey, type purchaseStatusFilters, rupiah } from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ExportButton } from "../../components/export-button.tsx";
import { StatusTag } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { DataTable, sortParams, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Sheet } from "../../components/ui/dialog.tsx";
import { Select } from "../../components/ui/field.tsx";
import { Amount, EmptyState, FilterRow, PageBody, PageHeader, StatTile } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";
import { LookupPicker, lookups, type Contact } from "../../components/lookup-picker.tsx";
import { type Period, PeriodFilter, periodLabel, periodQuery, presetPeriod } from "../../components/period-filter.tsx";
import { PurchaseForm } from "./purchase-form.tsx";
import { PurchaseSheet } from "./purchase-sheet.tsx";

type StatusFilter = (typeof purchaseStatusFilters)[number];

const statusLabels: Record<StatusFilter, string> = {
  unpaid: "Belum bayar",
  partial: "Sebagian",
  overdue: "Telat",
  paid: "Lunas",
  void: "Dibatalkan",
};

/** Pembelian. The open invoice lives in the URL (`/pembelian?id=…`) so other pages can link to it. */
export function PurchasesPage() {
  const search: { id?: string } = useSearch({ strict: false });
  const navigate = useNavigate();
  const openInvoice = (id: string | null) => void navigate({ to: "/pembelian", search: id ? { id } : {} });
  const [creating, setCreating] = useState(false);

  const [period, setPeriod] = useState<Period>(() => presetPeriod("month"));
  const [status, setStatus] = useState<StatusFilter | "">("");
  const [supplier, setSupplier] = useState<Contact | null>(null);
  const filters = { ...periodQuery(period), ...(status && { status }), ...(supplier && { supplierId: supplier.id }) };

  const paged = usePagedQuery(
    ["purchases", "list", filters],
    (params) =>
      unwrap(
        api.purchases.$get({
          query: { ...filters, q: params.q, page: String(params.page), pageSize: String(params.pageSize), ...sortParams(params.sort) },
        }),
      ),
    { sort: { key: "status" as PurchaseSortKey, dir: "asc" } },
  );
  const filter = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    paged.setPage(1);
  };
  const summary = paged.query.data?.summary;
  const windowLabel = periodLabel(period);

  return (
    <>
      <PageHeader
        title="Pembelian"
        actions={
          <>
            <ExportButton path={`/api/purchases/export.xlsx?${new URLSearchParams({ ...filters, ...(paged.q && { q: paged.q }), ...sortParams(paged.sort) })}`} />
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              Pembelian baru
            </Button>
          </>
        }
      />
      <PageBody>
        <FilterRow aside={paged.query.data && `${paged.query.data.total} faktur`}>
          <PeriodFilter value={period} onChange={filter(setPeriod)} />
          <Select className="w-40" aria-label="Status" value={status} onChange={(e) => filter(setStatus)(e.target.value as StatusFilter | "")}>
            <option value="">Semua status</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <div className="w-64">
            <LookupPicker kind="supplier" lookup={lookups.supplier} value={supplier} onChange={filter(setSupplier)} placeholder="Semua pemasok" />
          </div>
        </FilterRow>

        <div className="grid grid-cols-4 gap-3.5 max-lg:grid-cols-2 max-md:grid-cols-2 max-md:gap-2 max-md:[&>:last-child:nth-child(odd)]:col-span-2">
          <StatTile
            label="Nilai pembelian"
            value={<Amount value={rupiah(summary?.purchased ?? 0)} />}
            note={`${windowLabel} · tanpa faktur yang dibatalkan`}
          />
          <StatTile label="Sudah dibayar" value={<Amount value={rupiah(summary?.paid ?? 0)} />} note={`${windowLabel} · tanpa faktur yang dibatalkan`} />
          <StatTile label="Sisa hutang" value={<Amount value={rupiah(summary?.outstanding ?? 0)} />} note={`${windowLabel} · sesuai filter`} />
          <StatTile
            label="Telat bayar"
            value={<Amount value={rupiah(summary?.overdue ?? 0)} className={cx(summary?.overdue && "text-down")} />}
            tone="warn"
            delta={summary?.dueSoon ? `${formatRupiah(summary.dueSoon, { compact: true })} jatuh tempo ≤7 hari` : undefined}
            note={`${windowLabel} · lewat jatuh tempo per hari ini`}
          />
        </div>

        <DataTable
          paged={paged}
          searchPlaceholder="Cari nomor, no. faktur pemasok, pemasok…"
          onRowClick={(row) => openInvoice(row.id)}
          empty={
            <EmptyState
              title="Belum ada pembelian di periode ini"
              action={<Button onClick={() => setCreating(true)}>Catat pembelian</Button>}
            />
          }
          columns={[
            {
              header: "Nomor",
              sort: "number",
              cell: (r) => (
                <span className="flex flex-col">
                  <span className={cx(r.status === "void" && "text-muted line-through")}>{r.number}</span>
                  {r.supplierInvoiceNumber && <span className="text-xs text-muted">{r.supplierInvoiceNumber}</span>}
                </span>
              ),
            },
            { header: "Tanggal", sort: "date", cell: (r) => formatDate(r.date), className: "whitespace-nowrap" },
            { header: "Pemasok", sort: "supplier", cell: (r) => r.supplierName },
            {
              header: "Jatuh tempo",
              sort: "dueDate",
              cell: (r) => <span className={cx(r.overdue && "text-down")}>{formatDate(r.dueDate)}</span>,
              className: "whitespace-nowrap",
            },
            { header: "Status", sort: "status", cell: (r) => <StatusTag state={r} /> },
            { header: "Total (Rp)", sort: "total", align: "right", cell: (r) => formatRupiah(r.total, { symbol: false }) },
            {
              header: "Sisa (Rp)",
              sort: "outstanding",
              align: "right",
              cell: (r) => (r.outstanding ? formatRupiah(r.outstanding, { symbol: false }) : <span className="text-faint">—</span>),
            },
          ]}
        />
      </PageBody>

      {creating && (
        <Sheet open className="max-w-5xl" onClose={() => setCreating(false)} title="Pembelian baru" description="Faktur dari pemasok">
          <PurchaseForm
            onCancel={() => setCreating(false)}
            onSaved={(id) => {
              setCreating(false);
              openInvoice(id);
            }}
          />
        </Sheet>
      )}
      {search.id && <PurchaseSheet id={search.id} onClose={() => openInvoice(null)} />}
    </>
  );
}
