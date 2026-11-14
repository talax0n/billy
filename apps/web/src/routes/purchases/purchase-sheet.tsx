import { formatDate, formatRupiah } from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { InferResponseType } from "hono/client";
import { Ban, Banknote, Pencil } from "lucide-react";
import { useState } from "react";
import { RevisionLinks } from "../../components/revision-links.tsx";
import { StatusTag } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Sheet } from "../../components/ui/dialog.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";
import { useRefreshAfterPosting } from "./actions.ts";
import { formatPercent, paymentMethodLabels, TotalsPanel } from "./bits.tsx";
import { PaymentDialog } from "./payment-dialog.tsx";
import { PurchaseForm } from "./purchase-form.tsx";
import { VoidDialog } from "./void-dialog.tsx";

type Purchase = InferResponseType<(typeof api.purchases)[":id"]["$get"], 200>;
type Payment = Purchase["payments"][number];

const qty = new Intl.NumberFormat("id-ID");

/** One supplier invoice: header, lines, totals, the payments timeline, and its actions. */
export function PurchaseSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const purchase = useQuery({
    queryKey: ["purchases", id],
    queryFn: () => unwrap(api.purchases[":id"].$get({ param: { id } })),
  });
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const p = purchase.data;
  const number = p ? p.number : purchase.isError ? "Faktur tidak ditemukan" : "Memuat…";
  return (
    <Sheet
      open
      onClose={onClose}
      className={editing ? "max-w-5xl" : "max-w-3xl"}
      title={editing ? `Ubah ${number}` : number}
      description={p && [p.supplierName, p.supplierInvoiceNumber && `No. pemasok ${p.supplierInvoiceNumber}`].filter(Boolean).join(" · ")}
    >
      {purchase.isError && <p className="text-down">{purchase.error.message}</p>}
      {p &&
        (editing ? (
          <PurchaseForm
            edit={p}
            onCancel={() => setEditing(false)}
            onSaved={(newId) => {
              setEditing(false);
              void navigate({ to: "/pembelian", search: { id: newId } });
            }}
          />
        ) : (
          <PurchaseDetail key={p.id} purchase={p} onEdit={() => setEditing(true)} />
        ))}
    </Sheet>
  );
}

function PurchaseDetail({ purchase: p, onEdit }: { purchase: Purchase; onEdit: () => void }) {
  const refresh = useRefreshAfterPosting();
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [voidingPayment, setVoidingPayment] = useState<Payment | null>(null);
  const voided = p.status === "void";
  const livePayments = p.payments.filter((payment) => !payment.voidedAt);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <dl className="grid grid-cols-3 gap-x-6 gap-y-1 max-sm:grid-cols-2">
          <dt className="text-muted">Tanggal</dt>
          <dt className="text-muted">Jatuh tempo</dt>
          <dt className="text-muted">Status</dt>
          <dd className="tabular-nums">{formatDate(p.date)}</dd>
          <dd className={cx("tabular-nums", p.overdue && "text-down")}>
            {formatDate(p.dueDate)} <span className="text-muted">({p.termsDays} hari)</span>
          </dd>
          <dd>
            <StatusTag state={p} />
          </dd>
        </dl>
        {!voided && (
          <div className="flex gap-2">
            <Button size="sm" onClick={onEdit}>
              <Pencil className="size-3.5" />
              Ubah
            </Button>
            {p.outstanding > 0 && (
              <Button variant="primary" size="sm" onClick={() => setPaying(true)}>
                <Banknote className="size-3.5" />
                Catat pembayaran
              </Button>
            )}
            <Button variant="danger" size="sm" onClick={() => setVoiding(true)}>
              <Ban className="size-3.5" />
              Void faktur
            </Button>
          </div>
        )}
      </div>

      {voided && (
        <p className="rounded-lg border border-line px-3 py-2.5 text-ink-2">
          Faktur ini sudah di-void. Alasan: {p.voidReason}. Stok barangnya sudah dikurangi kembali.
        </p>
      )}
      {(p.revisionOf || p.revisedBy) && (
        <div className="flex flex-wrap gap-3">
          <RevisionLinks path="/pembelian" revisionOf={p.revisionOf} revisedBy={p.revisedBy} />
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[520px] border-collapse">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="px-4 py-2 text-left font-normal">Barang</th>
              <th className="px-2 py-2 text-right font-normal">Qty</th>
              <th className="px-2 py-2 text-right font-normal">Harga satuan (Rp)</th>
              <th className="px-2 py-2 text-right font-normal">Diskon (Rp)</th>
              <th className="px-4 py-2 text-right font-normal">Jumlah (Rp)</th>
            </tr>
          </thead>
          <tbody>
            {p.lines.map((line) => (
              <tr key={line.id} className="border-b border-line-2 last:border-b-0">
                <td className="px-4 py-2">
                  {line.productName} {line.variant && <span className="text-muted">{line.variant}</span>}
                  {line.note && <div className="text-xs text-muted">{line.note}</div>}
                </td>
                <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">
                  {qty.format(line.qty)} <span className="text-muted">{line.unit}</span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{formatRupiah(line.unitCost, { symbol: false })}</td>
                <td className="px-2 py-2 text-right tabular-nums text-muted">{line.discountAmount ? formatRupiah(line.discountAmount, { symbol: false }) : "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatRupiah(line.lineTotal, { symbol: false })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_280px] gap-6 max-md:grid-cols-1">
        <div className="text-ink-2">{p.note}</div>
        <TotalsPanel
          rows={[
            { label: "Subtotal", value: p.subtotal },
            { label: "Diskon faktur", value: p.discountAmount },
            { label: `PPN ${formatPercent(p.taxRateBp)}`, value: p.taxAmount },
            { label: "Total", value: p.total, strong: true },
            { label: "Dibayar", value: p.paid },
            { label: "Sisa hutang", value: p.outstanding, tone: p.overdue ? "down" : undefined },
          ]}
        />
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="font-medium">Pembayaran</h3>
        {p.payments.length === 0 ? (
          <p className="text-muted">Belum ada pembayaran.</p>
        ) : (
          <ol className="ml-1 flex flex-col border-l border-line">
            {p.payments.map((payment) => (
              <li key={payment.id} className="relative flex gap-3 pb-4 pl-4 last:pb-0">
                <span className={cx("absolute top-1.5 -left-1 size-[7px] rounded-full", payment.voidedAt ? "bg-faint" : "bg-up")} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={cx(payment.voidedAt && "text-muted line-through")}>
                      {formatDate(payment.date)} · {payment.accountName} · {paymentMethodLabels[payment.method]}
                    </span>
                    <span className={cx("tabular-nums", payment.voidedAt && "text-muted line-through")}>{formatRupiah(payment.amount)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs text-muted">
                    <span>
                      {payment.voidedAt ? `Void: ${payment.voidReason}` : `Dicatat ${payment.createdByName}`}
                      {payment.note && ` · ${payment.note}`}
                    </span>
                    {!payment.voidedAt && (
                      <Button variant="ghost" size="sm" onClick={() => setVoidingPayment(payment)}>
                        Void pembayaran
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <PaymentDialog invoice={paying ? p : null} onClose={() => setPaying(false)} />
      <VoidDialog
        open={voiding}
        title="Void faktur"
        description={`${p.number} · ${formatRupiah(p.total)}`}
        consequence="Stok setiap barang di faktur ini dikurangi kembali. Harga pokok produk tidak berubah."
        blocked={
          livePayments.length > 0
            ? `Faktur ini masih punya ${livePayments.length} pembayaran. Void pembayarannya dulu, baru faktur bisa di-void.`
            : undefined
        }
        onConfirm={async (reason) => {
          await unwrap(api.purchases[":id"].void.$post({ param: { id: p.id }, json: { reason } }));
          await refresh();
          toast(`${p.number} di-void`, "up");
        }}
        onClose={() => setVoiding(false)}
      />
      <VoidDialog
        open={voidingPayment !== null}
        title="Void pembayaran"
        description={voidingPayment && `${formatDate(voidingPayment.date)} · ${voidingPayment.accountName} · ${formatRupiah(voidingPayment.amount)}`}
        consequence="Uangnya dicatat kembali masuk ke akun asal hari ini, dan sisa hutang faktur bertambah lagi."
        onConfirm={async (reason) => {
          await unwrap(
            api.purchases[":id"].payments[":paymentId"].void.$post({ param: { id: p.id, paymentId: voidingPayment!.id }, json: { reason } }),
          );
          await refresh();
          toast("Pembayaran di-void", "up");
        }}
        onClose={() => setVoidingPayment(null)}
      />
    </div>
  );
}
