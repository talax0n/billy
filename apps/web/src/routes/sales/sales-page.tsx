import { formatDate, formatRupiah, rupiah } from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlert, Plus } from "lucide-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { ExportButton } from "../../components/export-button.tsx";
import { StatusTag } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { EmptyState, FilterRow, PageBody, PageHeader, StatTile } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";
import { type Contact, LookupPicker, lookups } from "../../components/lookup-picker.tsx";
import { InvoiceSheet } from "./invoice-sheet.tsx";
import { attentionQuery } from "../../lib/attention.ts";
import { type Period, PeriodFilter, periodLabel, periodQuery, presetPeriod } from "../../components/period-filter.tsx";

const chips = [
  { status: "", label: "Semua" },
  { status: "overdue", label: "Telat bayar" },
  { status: "due", label: "Belum lunas" },
  { status: "paid", label: "Lunas" },
  { status: "void", label: "Void" },
] as const;
type ChipStatus = (typeof chips)[number]["status"];

/** Penjualan. The open invoice lives in the URL (`/penjualan?id=…`) so other pages can link to it. */
export function SalesPage() {
  const search: { id?: string } = useSearch({ strict: false });
  const navigate = useNavigate();
  const openInvoice = (id: string | null) => void navigate({ to: "/penjualan", search: id ? { id } : {} });
  const [creating, setCreating] = useState(false);
  const [period, setPeriod] = useState<Period>(() => presetPeriod("month"));
  const [status, setStatus] = useState<ChipStatus>("");
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
  const overdue = useQuery({ ...attentionQuery, refetchOnMount: "always" }).data?.overdueInvoices;
  const chipCount = (chip: ChipStatus) =>
    summary && (chip ? summary.counts[chip] : summary.counts.overdue + summary.counts.due + summary.counts.paid + summary.counts.void);
  const windowNote = `Faktur ${periodLabel(period)}${status ? ` · ${chips.find((c) => c.status === status)!.label}` : ""}${customer ? ` · ${customer.name}` : ""}`;
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
        {overdue && overdue.count > 0 && (
          <div role="alert" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-down/30 bg-down/10 px-4 py-3 text-down">
            <TriangleAlert className="size-5 shrink-0" />
            <p className="flex-1 font-medium">
              {overdue.count} faktur telat bayar · total {money(overdue.outstanding)}
            </p>
            <Button
              variant="danger"
              onClick={() => {
                setPeriod(presetPeriod("all"));
                setStatus("overdue");
              }}
            >
              Lihat faktur telat
            </Button>
          </div>
        )}
        <FilterRow aside={summary && `${summary.count} faktur`}>
          <PeriodFilter value={period} onChange={setPeriod} />
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
        <div role="group" aria-label="Status faktur" className="flex flex-wrap gap-2">
          {chips.map((chip) => {
            const n = chipCount(chip.status);
            const late = chip.status === "overdue" && !!n;
            return (
              <button
                key={chip.status}
                type="button"
                aria-pressed={status === chip.status}
                onClick={() => setStatus(chip.status)}
                className={cx(
                  "inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-line bg-panel px-3.5 font-medium text-ink-2 hover:bg-line-2",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                  "aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-panel",
                  late && "border-down/40 text-down aria-pressed:border-down aria-pressed:bg-down",
                )}
              >
                {chip.label}
                <span className="tabular-nums opacity-70">{n ?? "–"}</span>
              </button>
            );
          })}
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
