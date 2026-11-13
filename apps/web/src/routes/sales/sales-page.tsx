import { formatDate, formatRupiah, rupiah, type SalesStatusFilter, salesStatusFilters } from "@billy/core";
import { Plus } from "lucide-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { ExportButton } from "../../components/export-button.tsx";
import { StatusTag } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Select } from "../../components/ui/field.tsx";
import { EmptyState, FilterRow, PageBody, PageHeader, StatTile } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";
import { type Contact, LookupPicker, lookups } from "../../components/lookup-picker.tsx";
import { InvoiceSheet } from "./invoice-sheet.tsx";
import { type Period, PeriodFilter, periodLabel, periodQuery, presetPeriod } from "../../components/period-filter.tsx";


const statusLabels: Record<SalesStatusFilter, string> = {
  open: "Belum lunas",
  unpaid: "Belum bayar",
  partial: "Sebagian",
  overdue: "Telat",
  paid: "Lunas",
  void: "Void",
};

/** Penjualan. The open invoice lives in the URL (`/penjualan?id=…`) so other pages can link to it. */
export function SalesPage() {
  const search: { id?: string } = useSearch({ strict: false });
  const navigate = useNavigate();
  const openInvoice = (id: string | null) => void navigate({ to: "/penjualan", search: id ? { id } : {} });
  const [creating, setCreating] = useState(false);
  const [period, setPeriod] = useState<Period>(() => presetPeriod("month"));
  const [status, setStatus] = useState<SalesStatusFilter | "">("");
  const [customer, setCustomer] = useState<Contact | null>(null);
  const filters = { ...periodQuery(period), ...(status && { status }), ...(customer && { customerId: customer.id }) };
  const paged = usePagedQuery(["sales", "list", period, status, customer?.id], (params) =>
    unwrap(
      api.sales.$get({
        query: {
          q: params.q,
          page: String(params.page),
          pageSize: String(params.pageSize),
          ...periodQuery(period),
          ...(status && { status }),
          ...(customer && { customerId: customer.id }),
        },
      }),
    ),
  );
  const summary = paged.query.data?.summary;
  const windowNote = `Faktur ${periodLabel(period)}${status ? ` · ${statusLabels[status]}` : ""}${customer ? ` · ${customer.name}` : ""}`;
  const money = (v: number | undefined) => (v === undefined ? "—" : formatRupiah(rupiah(v)));

  return (
    <>
      <PageHeader
        title="Penjualan"
        actions={
          <>
            <ExportButton path={`/api/sales/export.xlsx?${new URLSearchParams({ ...filters, ...(paged.q && { q: paged.q }) })}`} />
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              Faktur baru
            </Button>
          </>
        }
      />
      <PageBody>
        <FilterRow aside={summary && `${summary.count} faktur`}>
          <PeriodFilter value={period} onChange={setPeriod} />
          <Select className="w-40" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as SalesStatusFilter | "")}>
            <option value="">Semua status</option>
            {salesStatusFilters.map((s) => (
              <option key={s} value={s}>
                {statusLabels[s]}
              </option>
            ))}
          </Select>
          <div className="w-56">
            <LookupPicker kind="customer" lookup={lookups.customer} value={customer} onChange={setCustomer} placeholder="Semua pelanggan" />
          </div>
          {customer && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCustomer(null)}
            >
              Hapus filter pelanggan
            </Button>
          )}
        </FilterRow>
        <div className="grid grid-cols-4 gap-3.5 max-lg:grid-cols-2 max-md:grid-cols-2 max-md:gap-2 max-md:[&>:last-child:nth-child(odd)]:col-span-2">
          <StatTile label="Total penjualan" value={money(summary?.total)} note={windowNote} />
          <StatTile label="Sudah dibayar" value={money(summary?.paid)} note={windowNote} />
          <StatTile label="Sisa piutang" value={money(summary?.outstanding)} note={`${windowNote} · sisa per hari ini`} />
          <StatTile
            label="Telat bayar"
            value={<span className={cx(summary && summary.overdue > 0 && "text-down")}>{money(summary?.overdue)}</span>}
            note={`${windowNote} · lewat jatuh tempo per hari ini`}
          />
        </div>
        <DataTable
          paged={paged}
          searchPlaceholder="Cari nomor faktur atau pelanggan…"
          onRowClick={(row) => openInvoice(row.id)}
          empty={<EmptyState title="Belum ada faktur di periode ini" action={<Button onClick={() => setCreating(true)}>Buat faktur</Button>} />}
          columns={[
            { header: "Nomor", cell: (r) => <span className="font-medium">{r.number}</span>, className: "whitespace-nowrap" },
            { header: "Pelanggan", cell: (r) => r.customerName },
            { header: "Tanggal", cell: (r) => formatDate(r.date), className: "whitespace-nowrap" },
            {
              header: "Jatuh tempo",
              cell: (r) => <span className={cx(r.state.overdue && "text-down")}>{formatDate(r.dueDate)}</span>,
              className: "whitespace-nowrap",
            },
            { header: "Total", align: "right", cell: (r) => money(r.total) },
            { header: "Dibayar", mobile: false, align: "right", cell: (r) => money(r.paid) },
            { header: "Sisa", align: "right", cell: (r) => money(r.state.outstanding) },
            { header: "Status", cell: (r) => <StatusTag state={r.state} /> },
          ]}
        />
      </PageBody>
      {creating && (
        <InvoiceSheet
          invoiceId={null}
          onOpenInvoice={(id) => {
            setCreating(false);
            openInvoice(id);
          }}
          onClose={() => setCreating(false)}
        />
      )}
      {search.id && <InvoiceSheet invoiceId={search.id} onOpenInvoice={openInvoice} onClose={() => openInvoice(null)} />}
    </>
  );
}
