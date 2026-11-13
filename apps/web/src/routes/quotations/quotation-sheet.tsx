import { formatDate, formatRupiah, type QuotationStatus, quotationStatusLabels, rupiah } from "@billy/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Ban, FilePlus, FileText, Send } from "lucide-react";
import { useState } from "react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Sheet } from "../../components/ui/dialog.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";
import { InvoiceForm } from "../sales/invoice-form.tsx";
import { ConvertDialog } from "./convert-dialog.tsx";
import { type QuotationDetail as Quotation, quotationQuery } from "./queries.ts";

/** `quotationId` null opens the create form; after saving the sheet shows the new quote. */
const tones = { draft: "neutral", sent: "warn", accepted: "up", rejected: "down", expired: "down" } as const;

export const QuotationStatusTag = ({ status }: { status: QuotationStatus }) => <Badge tone={tones[status]}>{quotationStatusLabels[status]}</Badge>;

export function QuotationSheet({
  quotationId,
  onOpenQuotation,
  onClose,
}: {
  quotationId: string | null;
  onOpenQuotation: (id: string) => void;
  onClose: () => void;
}) {
  const quotation = useQuery({ ...quotationQuery(quotationId ?? ""), enabled: quotationId !== null });
  return (
    <Sheet
      open
      onClose={onClose}
      className={quotationId === null ? "max-w-5xl" : "max-w-2xl"}
      title={quotationId === null ? "Penawaran harga baru" : (quotation.data?.number ?? "Memuat…")}
      description={quotation.data && `${quotation.data.customer.name} · ${formatDate(quotation.data.date)} · berlaku sampai ${formatDate(quotation.data.validUntil)}`}
    >
      {quotationId === null ? <InvoiceForm kind="quote" onSaved={onOpenQuotation} /> : quotation.data && <QuotationDetail quotation={quotation.data} />}
    </Sheet>
  );
}

const money = (value: number) => formatRupiah(rupiah(value));

function QuotationDetail({ quotation }: { quotation: Quotation }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [converting, setConverting] = useState(false);
  const live = quotation.status === "draft" || quotation.status === "sent";
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["quotations"] });
  const mark = async (status: "sent" | "rejected") => {
    await unwrap(api.quotations[":id"].status.$post({ param: { id: quotation.id }, json: { status } }));
    await refresh();
    toast(status === "sent" ? "Penawaran ditandai terkirim" : "Penawaran ditandai ditolak", "up");
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <QuotationStatusTag status={quotation.status} />
        {quotation.invoiceId && (
          <Link to="/penjualan" search={{ id: quotation.invoiceId }} className="text-ink-2 underline hover:text-ink">
            Faktur {quotation.invoiceNumber}
          </Link>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" onClick={() => window.open(`/cetak/penawaran/${quotation.id}`, "_blank", "noopener")}>
            <FileText className="size-3.5" />
            Cetak penawaran
          </Button>
          {quotation.status === "draft" && (
            <Button size="sm" onClick={() => void mark("sent")}>
              <Send className="size-3.5" />
              Tandai terkirim
            </Button>
          )}
          {live && (
            <Button size="sm" variant="danger" onClick={() => void mark("rejected")}>
              <Ban className="size-3.5" />
              Tandai ditolak
            </Button>
          )}
          {live && (
            <Button size="sm" variant="primary" onClick={() => setConverting(true)}>
              <FilePlus className="size-3.5" />
              Jadikan faktur
            </Button>
          )}
        </div>
      </div>

      <section className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[520px] border-collapse">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-2 font-normal">Barang</th>
              <th className="px-2 py-2 text-right font-normal">Jumlah</th>
              <th className="px-2 py-2 text-right font-normal">Harga</th>
              <th className="px-4 py-2 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody>
            {quotation.lines.map((line, i) => (
              <tr key={i} className="border-b border-line-2 align-top last:border-b-0">
                <td className="px-4 py-2.5">
                  {line.productName} <span className="text-muted">{line.variant}</span>
                  {line.note && <div className="text-xs text-ink-2">{line.note}</div>}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {line.qty} <span className="text-muted">{line.unit}</span>
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {money(line.unitPrice)}
                  {line.discountAmount > 0 && <div className="text-xs text-muted">diskon {money(line.discountAmount)}</div>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line">
            <TotalRow label="Subtotal" value={money(quotation.subtotal)} />
            {quotation.discountAmount > 0 && <TotalRow label="Diskon" value={`− ${money(quotation.discountAmount)}`} />}
            <TotalRow label="Total" value={money(quotation.total)} strong />
          </tfoot>
        </table>
      </section>
      {quotation.note && <p className="text-ink-2">Catatan: {quotation.note}</p>}
      <p className="text-xs text-muted">Dibuat {quotation.createdByName}</p>

      {converting && (
        <ConvertDialog
          quotation={quotation}
          onClose={() => setConverting(false)}
          onConverted={async (invoiceId) => {
            await refresh();
            await queryClient.invalidateQueries({ queryKey: ["sales"] });
            await queryClient.invalidateQueries({ queryKey: ["products"] });
            toast(`${quotation.number} jadi faktur`, "up");
            void navigate({ to: "/penjualan", search: { id: invoiceId } });
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
