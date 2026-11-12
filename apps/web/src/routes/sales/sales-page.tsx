import { formatDate, formatRupiah, rupiah, type SalesStatusFilter, salesStatusFilters } from "@billy/core";
import type { InferResponseType } from "hono/client";
import { Plus } from "lucide-react";
import { useState } from "react";
import { StatusTag } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Select } from "../../components/ui/field.tsx";
import { EmptyState, FilterRow, PageBody, PageHeader, StatTile } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";
import { CustomerPicker } from "./customer-picker.tsx";
import { InvoiceSheet } from "./invoice-sheet.tsx";
import { type Customer, type Period, periodLabel, periodRange, periods } from "./queries.ts";

type SalesList = InferResponseType<typeof api.sales.$get, 200>;

const statusLabels: Record<SalesStatusFilter, string> = {
  open: "Belum lunas",
  unpaid: "Belum bayar",
  partial: "Sebagian",
  overdue: "Telat",
  paid: "Lunas",
  void: "Void",
};

export function SalesPage() {
  const [period, setPeriod] = useState<Period>("month");
  const [status, setStatus] = useState<SalesStatusFilter | "">("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const paged = usePagedQuery(["sales", "list", period, status, customer?.id], (params) =>
    unwrap(
      api.sales.$get({
        query: {
          q: params.q,
          page: String(params.page),
          pageSize: String(params.pageSize),
          ...periodRange(period),
          ...(status && { status }),
          ...(customer && { customerId: customer.id }),
        },
      }),
    ),
  );
  /** null: closed; "new": create form; a string: the invoice shown. */
  const [open, setOpen] = useState<string | null>(null);
  // usePagedQuery types its data as plain `{ rows, total }`; this endpoint also sends the summary.
  const summary = (paged.query.data as SalesList | undefined)?.summary;
  const windowNote = `${periodLabel(period)}${status ? ` · ${statusLabels[status]}` : ""}${customer ? ` · ${customer.name}` : ""}`;
  const money = (v: number | undefined) => (v === undefined ? "—" : formatRupiah(rupiah(v)));

  return (
    <>
      <PageHeader
        title="Penjualan"
        description="Faktur penjualan tunai dan tempo, pembayaran, dan pengiriman."
        actions={
          <Button variant="primary" onClick={() => setOpen("new")}>
            <Plus className="size-4" />
            Faktur baru
          </Button>
        }
      />
      <PageBody>
        <FilterRow aside={summary && `${summary.count} faktur`}>
          <div className="w-44">
            <Select aria-label="Periode" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
              {Object.entries(periods).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-40">
            <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as SalesStatusFilter | "")}>
              <option value="">Semua status</option>
              {salesStatusFilters.map((s) => (
                <option key={s} value={s}>
                  {statusLabels[s]}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-56">
            <CustomerPicker key={pickerKey} value={customer} onChange={setCustomer} placeholder="Semua pelanggan" />
          </div>
          {customer && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCustomer(null);
                setPickerKey((k) => k + 1);
              }}
            >
              Hapus filter pelanggan
            </Button>
          )}
        </FilterRow>
        <div className="grid grid-cols-4 gap-3.5">
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
          onRowClick={(row) => setOpen(row.id)}
          empty={<EmptyState title="Belum ada faktur di periode ini" action={<Button onClick={() => setOpen("new")}>Buat faktur</Button>} />}
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
            { header: "Dibayar", align: "right", cell: (r) => money(r.paid) },
            { header: "Sisa", align: "right", cell: (r) => money(r.state.outstanding) },
            { header: "Status", cell: (r) => <StatusTag state={r.state} /> },
          ]}
        />
      </PageBody>
      {open && <InvoiceSheet invoiceId={open === "new" ? null : open} onOpenInvoice={setOpen} onClose={() => setOpen(null)} />}
    </>
  );
}
