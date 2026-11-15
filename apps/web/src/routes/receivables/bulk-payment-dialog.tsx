import { allocatePayment, bulkSalesPaymentInput, businessDate, DomainError, formatRupiah, rupiah, type PayableInvoice } from "@billy/core";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/ui/button.tsx";
import { Dialog } from "../../components/ui/dialog.tsx";
import { DateInput, Field } from "../../components/ui/field.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { useForm } from "../../lib/form.ts";
import { PaymentFields } from "../sales/payment-fields.tsx";

/** One payment over several faktur of one customer; shows how it will be split before saving. */
export function BulkPaymentDialog({ customerName, invoices, onClose }: { customerName: string; invoices: PayableInvoice[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const owed = invoices.reduce((sum, inv) => sum + inv.outstanding, 0);
  const form = useForm(bulkSalesPaymentInput, {
    invoiceIds: invoices.map((inv) => inv.id),
    accountId: "",
    amount: owed,
    method: "transfer",
    date: businessDate(),
    proofUrl: "",
    note: "",
  });
  const split = previewSplit(invoices, form.values.amount);
  const submit = form.onSubmit(async (input) => {
    await unwrap(api.sales.payments.$post({ json: input }));
    await queryClient.invalidateQueries({ queryKey: ["sales"] });
    await queryClient.invalidateQueries({ queryKey: ["insights"] });
    toast(`Pembayaran ${invoices.length} faktur dicatat`, "up");
    onClose();
  });

  return (
    <Dialog open onClose={onClose} title="Bayar beberapa faktur" description={`${customerName} · ${invoices.length} faktur · sisa ${formatRupiah(rupiah(owed))}`}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Tanggal bayar" error={form.errors.date}>
          {(p) => <DateInput {...p} value={form.values.date} onChange={(e) => form.set("date", e.target.value)} />}
        </Field>
        <PaymentFields values={form.values} onChange={(patch) => form.setValues((v) => ({ ...v, ...patch }))} errors={form.errors} outstanding={owed} />
        {split && (
          <ul className="flex flex-col rounded-[10px] border border-line text-sm">
            <li className="border-b border-line-2 px-3 py-2 text-xs text-muted">Dibagi mulai jatuh tempo paling awal</li>
            {split.map(({ invoice, amount }) => {
              const left = invoice.outstanding - amount;
              return (
                <li key={invoice.id} className="flex items-center gap-3 border-b border-line-2 px-3 py-2 last:border-b-0">
                  <span className="flex-1 font-medium">{invoice.number}</span>
                  <span className="tabular-nums">{formatRupiah(rupiah(amount))}</span>
                  <span className={left > 0 ? "w-36 text-right text-warn" : "w-36 text-right text-up"}>
                    {left > 0 ? `sisa ${formatRupiah(rupiah(left))}` : "lunas"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Batal</Button>
          <Button type="submit" variant="primary" disabled={form.submitting || !split}>
            Simpan pembayaran
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** The split the server will make, or null while the amount is empty or too large. */
function previewSplit(invoices: PayableInvoice[], amount: number) {
  try {
    return allocatePayment(invoices, rupiah(amount));
  } catch (err) {
    if (err instanceof DomainError) return null;
    throw err;
  }
}
