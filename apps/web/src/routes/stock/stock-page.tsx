import { formatDate, formatRupiah, type stockReasons } from "@billy/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { InferResponseType } from "hono/client";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { type Column, DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Select } from "../../components/ui/field.tsx";
import { EmptyState, FilterRow, PageBody, PageHeader } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";
import { StockAdjustDialog } from "../products/stock-adjust-dialog.tsx";
import { StockQty } from "../products/stock-qty.tsx";
import { timeOfDay } from "../purchases/bits.tsx";
import { LookupPicker, lookups } from "../purchases/lookups.tsx";
import { type Period, PeriodFilter, periodQuery, presetPeriod } from "../purchases/period-filter.tsx";
import { sourceDocuments } from "./source-documents.ts";

type Reason = (typeof stockReasons)[number];
type Movement = InferResponseType<typeof api.stock.movements.$get, 200>["rows"][number];

const reasonLabels: Record<Reason, string> = {
  purchase: "Pembelian",
  sale: "Penjualan",
  pos: "Kasir",
  adjustment: "Penyesuaian",
  reversal: "Pembatalan",
};

const qty = new Intl.NumberFormat("id-ID");
const signed = (n: number) => (n > 0 ? `+${qty.format(n)}` : qty.format(n));

/** Mutasi Stok: the ledger of every stock movement, and the products that need restocking. */
export function StockPage() {
  const [tab, setTab] = useState<"ledger" | "alerts">("ledger");
  const [productId, setProductId] = useState<string | null>(null);
  const alerts = usePagedQuery(["stock", "alerts"], (params) =>
    unwrap(api.stock.alerts.$get({ query: { page: String(params.page), pageSize: String(params.pageSize) } })),
  );
  const alertCount = alerts.query.data?.total;
  const tabs = [
    { key: "ledger", label: "Mutasi" },
    { key: "alerts", label: `Stok minus / di bawah minimum${alertCount ? ` (${alertCount})` : ""}` },
  ] as const;

  return (
    <>
      <PageHeader title="Mutasi Stok" description="Setiap perubahan stok: pembelian, penjualan, kasir, penyesuaian, dan pembatalan." />
      <div role="tablist" className="flex gap-1 border-b border-line px-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cx(
              "-mb-px border-b-2 px-2 py-2.5 text-muted",
              tab === t.key ? "border-ink font-medium text-ink" : "border-transparent hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <PageBody>
        {tab === "ledger" ? (
          <Ledger productId={productId} onProductChange={setProductId} />
        ) : (
          <DataTable
            paged={alerts}
            search={false}
            onRowClick={(row) => {
              setProductId(row.id);
              setTab("ledger");
            }}
            empty={<EmptyState title="Semua stok aman" description="Tidak ada produk aktif yang stoknya minus atau di bawah minimum." />}
            columns={[
              { header: "Kode", cell: (p) => <span className="text-muted">{p.code ?? "—"}</span>, className: "w-28" },
              { header: "Produk", cell: (p) => [p.name, p.variant].filter(Boolean).join(" ") },
              { header: "Stok", align: "right", cell: (p) => <StockQty product={p} /> },
              { header: "Minimum", align: "right", cell: (p) => qty.format(p.minStock) },
              { header: "Kurang", align: "right", cell: (p) => <span className="text-down">{qty.format(p.minStock - p.stock)}</span> },
            ]}
          />
        )}
      </PageBody>
    </>
  );
}

function Ledger({ productId, onProductChange }: { productId: string | null; onProductChange: (id: string | null) => void }) {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<Period>(() => presetPeriod("month"));
  const [reason, setReason] = useState<Reason | "">("");
  const [adjusting, setAdjusting] = useState(false);
  const product = useQuery({
    queryKey: ["products", productId],
    queryFn: () => unwrap(api.products[":id"].$get({ param: { id: productId! } })),
    enabled: productId !== null,
  });
  const selected = productId ? (product.data ?? null) : null;

  const filters = { ...periodQuery(period), ...(reason && { reason }), ...(productId && { productId }) };
  const paged = usePagedQuery(["stock", "movements", filters], (params) =>
    unwrap(api.stock.movements.$get({ query: { ...filters, page: String(params.page), pageSize: String(params.pageSize) } })),
  );
  const filter = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    paged.setPage(1);
  };

  // With one product selected its name is implied, and running stock becomes meaningful.
  const columns: (Column<Movement> | false)[] = [
    { header: "Tanggal", cell: (m) => formatDate(m.date), className: "whitespace-nowrap" },
    selected === null && {
      header: "Produk",
      cell: (m) => (
        <button type="button" className="text-left hover:underline" onClick={() => filter(onProductChange)(m.productId)}>
          {m.productName} {m.variant && <span className="text-muted">{m.variant}</span>}
        </button>
      ),
    },
    { header: "Jenis", cell: (m) => reasonLabels[m.reason] },
    {
      header: "Jumlah",
      align: "right",
      cell: (m) => (
        <span className={m.qty < 0 ? "text-down" : "text-up"}>
          {signed(m.qty)} <span className="text-muted">{m.unit}</span>
        </span>
      ),
    },
    selected !== null && { header: "Stok", align: "right", cell: (m) => qty.format(m.runningStock ?? 0) },
    { header: "Harga pokok", align: "right", cell: (m) => formatRupiah(m.unitCost) },
    {
      header: "Dokumen",
      cell: (m) => {
        if (!m.sourceType || !m.sourceId) return <span className="text-faint">—</span>;
        const doc = sourceDocuments[m.sourceType];
        return (
          <Link to={doc.path} search={{ id: m.sourceId }} className="whitespace-nowrap hover:underline">
            <span className="text-muted">{doc.label}</span> {m.sourceNumber}
          </Link>
        );
      },
    },
    { header: "Catatan", cell: (m) => <span className="text-ink-2">{m.note}</span> },
    { header: "Oleh", cell: (m) => <span className="text-muted">{m.createdByName}</span> },
  ];

  return (
    <>
      <FilterRow aside={paged.query.dataUpdatedAt ? `Data per ${timeOfDay.format(paged.query.dataUpdatedAt)}` : undefined}>
        <div className="w-72">
          <LookupPicker
            kind="product"
            lookup={lookups.product}
            value={selected}
            placeholder="Semua produk (ketik untuk cari)"
            onChange={(row) => filter(onProductChange)(row?.id ?? null)}
          />
        </div>
        <PeriodFilter value={period} onChange={filter(setPeriod)} />
        <div className="w-40">
          <Select aria-label="Jenis mutasi" value={reason} onChange={(e) => filter(setReason)(e.target.value as Reason | "")}>
            <option value="">Semua jenis</option>
            {Object.entries(reasonLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </FilterRow>

      {selected && (
        <div className="flex items-center justify-between rounded-xl border border-line px-4 py-3">
          <div>
            <div className="text-ink-2">Stok sekarang · {lookups.product.label(selected)}</div>
            <div className="mt-1 text-[22px] font-medium tracking-tight">
              <StockQty product={selected} />
            </div>
            <div className="text-xs text-muted">
              Minimum {qty.format(selected.minStock)} {selected.unit} · harga pokok {formatRupiah(selected.costPrice)}
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => filter(onProductChange)(null)}>
              Semua produk
            </Button>
            <Button size="sm" onClick={() => setAdjusting(true)}>
              <SlidersHorizontal className="size-3.5" />
              Sesuaikan stok
            </Button>
          </div>
        </div>
      )}

      <DataTable
        paged={paged}
        search={false}
        empty={<EmptyState title="Belum ada mutasi" description="Tidak ada mutasi stok untuk filter ini." />}
        columns={columns.filter((column) => column !== false)}
      />

      {selected && (
        <StockAdjustDialog
          product={selected}
          open={adjusting}
          onClose={() => {
            setAdjusting(false);
            void queryClient.invalidateQueries({ queryKey: ["stock"] });
          }}
        />
      )}
    </>
  );
}
