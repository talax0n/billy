import { formatDate, formatRupiah, type purchaseStatusFilters, rupiah } from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { StatusTag } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Sheet } from "../../components/ui/dialog.tsx";
import { Select } from "../../components/ui/field.tsx";
import { EmptyState, FilterRow, PageBody, PageHeader, StatTile } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";
import { Amount, timeOfDay } from "./bits.tsx";
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
  void: "Void",
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

  const paged = usePagedQuery(["purchases", "list", filters], (params) =>
    unwrap(api.purchases.$get({ query: { ...filters, q: params.q, page: String(params.page), pageSize: String(params.pageSize) } })),
  );
  const filter = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    paged.setPage(1);
  };
  const summary = paged.query.data?.summary;
  const payables = useQuery({
    queryKey: ["purchases", "payables", "totals"],
    queryFn: () => unwrap(api.purchases.payables.$get({ query: { pageSize: "1" } })),
  });
  const windowLabel = periodLabel(period);

  return (
    <>
      <PageHeader
        title="Pembelian"
        description="Faktur dari pemasok. Menyimpan faktur menambah stok dan memperbarui harga pokok."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Pembelian baru
          </Button>
        }
      />
      <PageBody>
        <FilterRow aside={paged.query.dataUpdatedAt ? `Data per ${timeOfDay.format(paged.query.dataUpdatedAt)}` : undefined}>
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

        <div className="grid grid-cols-3 gap-3.5">
          <StatTile
            label="Nilai pembelian"
            value={<Amount value={rupiah(summary?.purchased ?? 0)} />}
            note={`${windowLabel} · tanpa faktur void`}
          />
          <StatTile label="Sisa hutang" value={<Amount value={rupiah(summary?.outstanding ?? 0)} />} note={`${windowLabel} · sesuai filter`} />
          <StatTile
            label="Jatuh tempo ≤7 hari"
            value={<Amount value={rupiah(payables.data?.totals.within7 ?? 0)} />}
            tone="down"
            delta={payables.data?.totals.late ? `+ ${formatRupiah(payables.data.totals.late)} telat` : undefined}
            note="Semua pemasok, semua tanggal faktur"
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
              cell: (r) => (
                <span className="flex flex-col">
                  <span className={cx(r.status === "void" && "text-muted line-through")}>{r.number}</span>
                  {r.supplierInvoiceNumber && <span className="text-xs text-muted">{r.supplierInvoiceNumber}</span>}
                </span>
              ),
            },
            { header: "Tanggal", cell: (r) => formatDate(r.date), className: "whitespace-nowrap" },
            { header: "Pemasok", cell: (r) => r.supplierName },
            {
              header: "Jatuh tempo",
              cell: (r) => <span className={cx(r.overdue && "text-down")}>{formatDate(r.dueDate)}</span>,
              className: "whitespace-nowrap",
            },
            { header: "Status", cell: (r) => <StatusTag state={r} /> },
            { header: "Total", align: "right", cell: (r) => formatRupiah(r.total) },
            {
              header: "Sisa",
              align: "right",
              cell: (r) => (r.outstanding ? formatRupiah(r.outstanding) : <span className="text-faint">—</span>),
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
