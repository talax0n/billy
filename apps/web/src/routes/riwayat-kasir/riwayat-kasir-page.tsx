import { formatRupiah, posVoidInput } from "@billy/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useState } from "react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Dialog, Sheet } from "../../components/ui/dialog.tsx";
import { Field, Input } from "../../components/ui/field.tsx";
import { EmptyState, PageBody, PageHeader } from "../../components/ui/page.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { useForm } from "../../lib/form.ts";
import { settingsQuery } from "../../lib/settings.ts";
import { methodLabels, printReceipt, ReceiptPrinter, receiptFromSale } from "../../pos/receipt.tsx";

const stamp = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });

/** Every POS receipt the server holds, newest first. Admin and staff void from the detail sheet. */
export function RiwayatKasirPage() {
  const paged = usePagedQuery(["pos", "sales"], (params) =>
    unwrap(api.pos.sales.$get({ query: { q: params.q, page: String(params.page), pageSize: String(params.pageSize) } })),
  );
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Riwayat Kasir" description="Struk penjualan kasir. Transaksi offline muncul setelah tersinkron." />
      <PageBody>
        <DataTable
          paged={paged}
          searchPlaceholder="Cari nomor struk…"
          onRowClick={(row) => setOpen(row.id)}
          empty={<EmptyState title="Belum ada transaksi kasir" />}
          columns={[
            { header: "No. struk", cell: (s) => <span className="font-medium">{s.number}</span>, className: "whitespace-nowrap" },
            { header: "Waktu", cell: (s) => <span className="text-ink-2">{stamp.format(new Date(s.soldAt))}</span> },
            { header: "Kasir", cell: (s) => s.cashierName },
            { header: "Bayar", cell: (s) => <span className="text-ink-2">{`${methodLabels[s.method]} · ${s.accountName}`}</span> },
            { header: "Status", cell: (s) => (s.voidedAt ? <Badge>Void</Badge> : <Badge tone="up">Lunas</Badge>) },
            { header: "Total", align: "right", cell: (s) => formatRupiah(s.total) },
          ]}
        />
      </PageBody>
      {open && <SaleSheet id={open} onClose={() => setOpen(null)} />}
      <ReceiptPrinter />
    </>
  );
}

function SaleSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const sale = useQuery({ queryKey: ["pos", "sales", id], queryFn: () => unwrap(api.pos.sales[":id"].$get({ param: { id } })) });
  const { data: shop } = useQuery(settingsQuery);
  const [voiding, setVoiding] = useState(false);
  const s = sale.data;

  return (
    <Sheet open onClose={onClose} title={s?.number ?? "Memuat…"} description={s && `${stamp.format(new Date(s.soldAt))} · ${s.cashierName}`}>
      {s && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2">
            {s.voidedAt ? <Badge>Void</Badge> : <Badge tone="up">Lunas</Badge>}
            <span className="text-ink-2">
              {methodLabels[s.method]} · masuk ke {s.accountName}
            </span>
            <span className="flex-1" />
            <Button size="sm" disabled={!shop} onClick={() => shop && printReceipt(receiptFromSale(s), shop)}>
              <Printer className="size-3.5" />
              Cetak ulang
            </Button>
            {!s.voidedAt && (
              <Button size="sm" variant="danger" onClick={() => setVoiding(true)}>
                Void
              </Button>
            )}
          </div>
          {s.voidedAt && <p className="rounded-lg bg-line-2 px-3 py-2 text-ink-2">Di-void: {s.voidReason}</p>}

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
      {s && <VoidDialog id={s.id} number={s.number} open={voiding} onClose={() => setVoiding(false)} />}
    </Sheet>
  );
}

function VoidDialog({ id, number, open, onClose }: { id: string; number: string; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title={`Void ${number}`} description="Stok dikembalikan dan uang dikeluarkan dari akun lewat baris pembalik.">
      {open && <VoidForm id={id} onDone={onClose} />}
    </Dialog>
  );
}

function VoidForm({ id, onDone }: { id: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm(posVoidInput, { reason: "" });
  const submit = form.onSubmit(async (input) => {
    await unwrap(api.pos.sales[":id"].void.$post({ param: { id }, json: input }));
    await queryClient.invalidateQueries({ queryKey: ["pos", "sales"] });
    toast("Struk di-void", "up");
    onDone();
  });
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label="Alasan" error={form.errors.reason}>
        {(p) => <Input {...p} autoFocus value={form.values.reason} onChange={(e) => form.set("reason", e.target.value)} />}
      </Field>
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Batal</Button>
        <Button type="submit" variant="danger" disabled={form.submitting}>
          Void struk
        </Button>
      </div>
    </form>
  );
}
