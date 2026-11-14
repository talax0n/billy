import { formatDate, formatRupiah, paymentMethodLabels, rupiah } from "@billy/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Ban, FileText, HandCoins, Pencil, Truck } from "lucide-react";
import { useState } from "react";
import { RevisionLinks } from "../../components/revision-links.tsx";
import { StatusTag } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Sheet } from "../../components/ui/dialog.tsx";
import { StatTile } from "../../components/ui/page.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";
import { InvoiceForm } from "./invoice-form.tsx";
import { PaymentDialog } from "./payment-dialog.tsx";
import { type InvoiceDetail as Invoice, invoiceQuery } from "./queries.ts";
import { VoidDialog } from "./void-dialog.tsx";

/** `invoiceId` null opens the create form; after saving the sheet shows the new invoice. */
export function InvoiceSheet({
  invoiceId,
  onOpenInvoice,
  onClose,
}: {
  invoiceId: string | null;
  onOpenInvoice: (id: string) => void;
  onClose: () => void;
}) {
  const invoice = useQuery({ ...invoiceQuery(invoiceId ?? ""), enabled: invoiceId !== null });
  const [editing, setEditing] = useState(false);
  const number = invoice.data?.number ?? "Memuat…";
  return (
    <Sheet
      open
      onClose={onClose}
      className={invoiceId === null || editing ? "max-w-5xl" : "max-w-2xl"}
      title={invoiceId === null ? "Faktur penjualan baru" : editing ? `Ubah ${number}` : number}
      description={invoice.data && `${invoice.data.customer.name} · ${formatDate(invoice.data.date)}`}
    >
      {invoiceId === null ? (
        <InvoiceForm onSaved={onOpenInvoice} />
      ) : (
        invoice.data &&
        (editing ? (
          <InvoiceForm
            edit={invoice.data}
            onSaved={(id) => {
              setEditing(false);
              onOpenInvoice(id);
            }}
          />
        ) : (
          <InvoiceDetail invoice={invoice.data} onEdit={() => setEditing(true)} />
        ))
      )}
    </Sheet>
  );
}

const money = (value: number) => formatRupiah(rupiah(value));
const amount = (value: number) => formatRupiah(rupiah(value), { symbol: false });
const openPrint = (path: string) => window.open(path, "_blank", "noopener");

function InvoiceDetail({ invoice, onEdit }: { invoice: Invoice; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<"pay" | "void" | { voidPayment: string } | null>(null);
  const voided = invoice.state.status === "void";
  const activePayments = invoice.payments.filter((p) => !p.voidedAt);
  const refresh = async (message: string) => {
    await queryClient.invalidateQueries({ queryKey: ["sales"] });
    await queryClient.invalidateQueries({ queryKey: ["insights"] });
    await queryClient.invalidateQueries({ queryKey: ["products"] });
    toast(message, "up");
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusTag state={invoice.state} />
        {voided && <span className="text-muted">Alasan pembatalan: {invoice.voidReason}</span>}
        <RevisionLinks path="/penjualan" revisionOf={invoice.revisionOf} revisedBy={invoice.revisedBy} />
        {invoice.quotation && (
          <Link to="/penawaran" search={{ id: invoice.quotation.id }} className="text-ink-2 underline hover:text-ink">
            Dari penawaran {invoice.quotation.number}
          </Link>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {!voided && invoice.state.outstanding > 0 && (
            <Button size="sm" variant="primary" onClick={() => setDialog("pay")}>
              <HandCoins className="size-3.5" />
              Catat pembayaran
            </Button>
          )}
          <Button size="sm" onClick={() => openPrint(`/cetak/faktur/${invoice.id}`)}>
            <FileText className="size-3.5" />
            Cetak faktur
          </Button>
          <Button size="sm" onClick={() => openPrint(`/cetak/surat-jalan/${invoice.id}`)}>
            <Truck className="size-3.5" />
            Cetak surat jalan
          </Button>
          {!voided && (
            <Button size="sm" onClick={onEdit}>
              <Pencil className="size-3.5" />
              Ubah
            </Button>
          )}
          {!voided && (
            <Button
              size="sm"
              variant="danger"
              disabled={activePayments.length > 0}
              title={activePayments.length > 0 ? "Batalkan dulu semua pembayaran faktur ini" : undefined}
              onClick={() => setDialog("void")}
            >
              <Ban className="size-3.5" />
              Batalkan faktur
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
        <StatTile label="Total" value={<small className="text-lg">{money(invoice.total)}</small>} />
        <StatTile label="Terbayar" value={<small className="text-lg">{money(invoice.paid)}</small>} />
        <StatTile
          label="Sisa"
          value={<small className={cx("text-lg", invoice.state.overdue && "text-down")}>{money(invoice.state.outstanding)}</small>}
          note={`Jatuh tempo ${formatDate(invoice.dueDate)}`}
        />
      </div>

      <section className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[520px] border-collapse">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-2 font-normal">Barang</th>
              <th className="px-2 py-2 text-right font-normal">Jumlah</th>
              <th className="px-2 py-2 text-right font-normal">Harga (Rp)</th>
              <th className="px-4 py-2 text-right font-normal">Total (Rp)</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.id} className="border-b border-line-2 align-top last:border-b-0">
                <td className="px-4 py-2.5">
                  {line.productName} <span className="text-muted">{line.variant}</span>
                  {line.note && <div className="text-xs text-ink-2">{line.note}</div>}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {line.qty} <span className="text-muted">{line.unit}</span>
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {amount(line.unitPrice)}
                  {line.discountAmount > 0 && <div className="text-xs text-muted">diskon {amount(line.discountAmount)}</div>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{amount(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line">
            <TotalRow label="Subtotal" value={amount(invoice.subtotal)} />
            {invoice.discountAmount > 0 && <TotalRow label="Diskon faktur" value={`− ${amount(invoice.discountAmount)}`} />}
            <TotalRow label="Total" value={amount(invoice.total)} strong />
          </tfoot>
        </table>
      </section>
      {invoice.note && <p className="text-ink-2">Catatan: {invoice.note}</p>}

      <section className="flex flex-col gap-3">
        <h3 className="font-medium">Pembayaran</h3>
        {invoice.payments.length === 0 ? (
          <p className="text-muted">Belum ada pembayaran.</p>
        ) : (
          <ol className="flex flex-col border-l border-line">
            {invoice.payments.map((p) => (
              <li key={p.id} className="relative flex items-start gap-3 py-2 pl-4">
                <span className={cx("absolute top-3.5 -left-[4px] size-[7px] rounded-full", p.voidedAt ? "bg-faint" : "bg-up")} />
                <div className="flex-1">
                  <div className={cx("flex items-baseline gap-2", p.voidedAt && "text-muted line-through")}>
                    <span className="font-medium tabular-nums">{money(p.amount)}</span>
                    <span className="text-ink-2">
                      {paymentMethodLabels[p.method]} · {p.accountName}
                    </span>
                  </div>
                  <div className="text-xs text-muted">
                    {formatDate(p.date)} · {p.createdByName}
                    {p.proofUrl && (
                      <>
                        {" · "}
                        <a href={p.proofUrl} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                          bukti
                        </a>
                      </>
                    )}
                    {p.voidedAt && ` · void: ${p.voidReason}`}
                  </div>
                </div>
                {!p.voidedAt && (
                  <Button size="sm" variant="ghost" onClick={() => setDialog({ voidPayment: p.id })}>
                    Batalkan pembayaran
                  </Button>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
      <p className="text-xs text-muted">
        Dibuat {invoice.createdByName} · tempo {invoice.termsDays} hari
      </p>

      {dialog === "pay" && <PaymentDialog invoice={invoice} onClose={() => setDialog(null)} />}
      {dialog === "void" && (
        <VoidDialog
          title="Batalkan faktur"
          description={`${invoice.number}. Stok barang dikembalikan lewat mutasi pembatalan.`}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await unwrap(api.sales[":id"].void.$post({ param: { id: invoice.id }, json: { reason } }));
            await refresh(`${invoice.number} dibatalkan`);
          }}
        />
      )}
      {typeof dialog === "object" && dialog !== null && (
        <VoidDialog
          title="Batalkan pembayaran"
          description="Saldo akun dikurangi lewat entri kas pembatalan."
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await unwrap(
              api.sales[":id"].payments[":paymentId"].void.$post({
                param: { id: invoice.id, paymentId: dialog.voidPayment },
                json: { reason },
              }),
            );
            await refresh("Pembayaran dibatalkan");
          }}
        />
      )}
    </div>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr className={cx(strong && "font-medium")}>
      <td colSpan={3} className="px-2 py-1.5 text-right text-ink-2">
        {label}
      </td>
      <td className="px-4 py-1.5 text-right tabular-nums">{value}</td>
    </tr>
  );
}
