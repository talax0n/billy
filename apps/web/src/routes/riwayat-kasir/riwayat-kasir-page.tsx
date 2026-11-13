import { formatRupiah } from "@billy/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Printer } from "lucide-react";
import { useState } from "react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Sheet } from "../../components/ui/dialog.tsx";
import { EmptyState, PageBody, PageHeader } from "../../components/ui/page.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { settingsQuery } from "../../lib/settings.ts";
import { countedReprint, methodLabels, printReceipt, ReceiptPrinter } from "../../pos/receipt.tsx";
import { VoidSaleDialog } from "../../pos/void-sale.tsx";

const stamp = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });

/**
 * Every POS receipt the server holds, newest first. Void is in the detail sheet; staff need an admin's approval.
 * The open receipt lives in the URL (`/riwayat-kasir?id=…`) so Mutasi Stok can link to it.
 */
export function RiwayatKasirPage() {
  const search: { id?: string } = useSearch({ strict: false });
  const navigate = useNavigate();
  const openSale = (id: string | null) => void navigate({ to: "/riwayat-kasir", search: id ? { id } : {} });
  const paged = usePagedQuery(["pos", "sales"], (params) =>
    unwrap(api.pos.sales.$get({ query: { q: params.q, page: String(params.page), pageSize: String(params.pageSize) } })),
  );

  return (
    <>
      <PageHeader title="Riwayat Kasir" />
      <PageBody>
        <DataTable
          paged={paged}
          searchPlaceholder="Cari nomor struk…"
          onRowClick={(row) => openSale(row.id)}
          empty={<EmptyState title="Belum ada transaksi kasir" />}
          columns={[
            { header: "No. struk", cell: (s) => <span className="font-medium">{s.number}</span>, className: "whitespace-nowrap" },
            { header: "Waktu", cell: (s) => <span className="text-ink-2">{stamp.format(new Date(s.soldAt))}</span> },
            { header: "Kasir", cell: (s) => s.cashierName },
            { header: "Bayar", cell: (s) => <span className="text-ink-2">{`${methodLabels[s.method]} · ${s.accountName}`}</span> },
            { header: "Status", cell: (s) => <SaleStatus sale={s} /> },
            { header: "Total", align: "right", cell: (s) => formatRupiah(s.total) },
          ]}
        />
      </PageBody>
      {search.id && <SaleSheet id={search.id} onOpen={openSale} onClose={() => openSale(null)} />}
      <ReceiptPrinter />
    </>
  );
}

/** Lunas, Void or Direvisi, with the other end of a revisi. */
function SaleStatus({ sale }: { sale: { voidedAt: string | null; revisedByNumber: string | null; revisionOfNumber: string | null } }) {
  return (
    <span className="flex flex-col items-start gap-0.5">
      {sale.revisedByNumber ? <Badge>Direvisi</Badge> : sale.voidedAt ? <Badge>Void</Badge> : <Badge tone="up">Lunas</Badge>}
      {sale.revisionOfNumber && <small className="text-muted">revisi dari {sale.revisionOfNumber}</small>}
    </span>
  );
}

function SaleSheet({ id, onOpen, onClose }: { id: string; onOpen: (id: string) => void; onClose: () => void }) {
  const sale = useQuery({ queryKey: ["pos", "sales", id], queryFn: () => unwrap(api.pos.sales[":id"].$get({ param: { id } })) });
  const { data: shop } = useQuery(settingsQuery);
  const [voiding, setVoiding] = useState(false);
  const queryClient = useQueryClient();
  const s = sale.data;
  const reprint = async () => {
    if (!s || !shop) return;
    try {
      printReceipt(await countedReprint(s.id), shop);
      await queryClient.invalidateQueries({ queryKey: ["pos", "sales", id] });
    } catch (err) {
      toast((err as Error).message, "down");
    }
  };

  return (
    <Sheet open onClose={onClose} title={s?.number ?? "Memuat…"} description={s && `${stamp.format(new Date(s.soldAt))} · ${s.cashierName}`}>
      {s && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2">
            <SaleStatus sale={s} />
            <span className="text-ink-2">
              {methodLabels[s.method]} · masuk ke {s.accountName}
            </span>
            <span className="flex-1" />
            <Button size="sm" disabled={!shop} onClick={() => void reprint()}>
              <Printer className="size-3.5" />
              Cetak ulang
            </Button>
            {!s.voidedAt && (
              <Button size="sm" variant="danger" onClick={() => setVoiding(true)}>
                Void
              </Button>
            )}
          </div>
          {s.revisedByNumber ? (
            <p className="rounded-lg bg-line-2 px-3 py-2 text-ink-2">
              Direvisi menjadi{" "}
              <button type="button" className="font-medium text-ink underline" onClick={() => onOpen(s.revisedById!)}>
                {s.revisedByNumber}
              </button>
              . {s.voidReason}
            </p>
          ) : (
            s.voidedAt && <p className="rounded-lg bg-line-2 px-3 py-2 text-ink-2">Di-void: {s.voidReason}</p>
          )}
          {s.revisionOf && (
            <p className="text-ink-2">
              Revisi dari{" "}
              <button type="button" className="font-medium text-ink underline" onClick={() => onOpen(s.revisionOf!)}>
                {s.revisionOfNumber}
              </button>{" "}
              · total lama {formatRupiah(s.revisionOfTotal!)}
            </p>
          )}
          {s.draftNumber && <p className="text-ink-2">Dari nota sementara {s.draftNumber}</p>}
          <p className="text-xs text-muted">Dicetak {s.printCount}×</p>

          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 font-normal">Produk</th>
                <th className="py-2 text-right font-normal">Qty</th>
                <th className="py-2 text-right font-normal">Harga</th>
                <th className="py-2 text-right font-normal">Diskon</th>
                <th className="py-2 text-right font-normal">Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l) => (
                <tr key={l.id} className="border-b border-line-2 align-top">
                  <td className="py-2">
                    {l.productName} <span className="text-muted">{l.variant}</span>
                    {l.note && <small className="block text-muted">{l.note}</small>}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {l.qty} {l.unit}
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatRupiah(l.unitPrice)}</td>
                  <td className="py-2 text-right tabular-nums text-muted">{l.discountAmount ? formatRupiah(l.discountAmount) : "—"}</td>
                  <td className="py-2 text-right tabular-nums">{formatRupiah(l.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="ml-auto grid w-64 grid-cols-2 gap-y-1 tabular-nums">
            <dt className="text-muted">Subtotal</dt>
            <dd className="text-right">{formatRupiah(s.subtotal)}</dd>
            <dt className="text-muted">Diskon transaksi</dt>
            <dd className="text-right">{formatRupiah(s.discountAmount)}</dd>
            <dt className="font-medium">Total</dt>
            <dd className="text-right font-medium">{formatRupiah(s.total)}</dd>
            <dt className="text-muted">Diterima</dt>
            <dd className="text-right">{formatRupiah(s.tendered)}</dd>
            <dt className="text-muted">Kembalian</dt>
            <dd className="text-right">{formatRupiah(s.change)}</dd>
          </dl>
        </div>
      )}
      {s && voiding && <VoidSaleDialog sale={s} onClose={() => setVoiding(false)} />}
    </Sheet>
  );
}
