import { businessDate, formatRupiah, type PurchasePaymentInput, purchasePaymentInput, type Rupiah } from "@billy/core";
import { Button } from "../../components/ui/button.tsx";
import { Dialog } from "../../components/ui/dialog.tsx";
import { DateInput, Field, Input, MoneyInput } from "../../components/ui/field.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { useForm } from "../../lib/form.ts";
import { useRefreshAfterPosting, useServerError } from "./actions.ts";
import { paymentMethodLabels, Segmented } from "./bits.tsx";
import { AccountSelect } from "../cash/account-select.tsx";

export interface PayableInvoice {
  id: string;
  number: string;
  supplierName: string;
  outstanding: Rupiah;
}

/** "Catat pembayaran": money out of a cash or bank account against one supplier invoice. */
export function PaymentDialog({ invoice, onClose }: { invoice: PayableInvoice | null; onClose: () => void }) {
  return (
    <Dialog
      open={invoice !== null}
      onClose={onClose}
      title="Catat pembayaran"
      description={invoice && `${invoice.number} · ${invoice.supplierName}`}
    >
      {invoice && <PaymentForm invoice={invoice} onDone={onClose} />}
    </Dialog>
  );
}

function PaymentForm({ invoice, onDone }: { invoice: PayableInvoice; onDone: () => void }) {
  const refresh = useRefreshAfterPosting();
  const server = useServerError();
  const initial: PurchasePaymentInput = { accountId: "", date: businessDate(), amount: invoice.outstanding, method: "transfer", note: "" };
  const form = useForm(purchasePaymentInput, initial);
  const v = form.values;

  const submit = form.onSubmit(async (json) => {
    const updated = await server.guard(unwrap(api.purchases[":id"].payments.$post({ param: { id: invoice.id }, json })));
    await refresh();
    toast(updated.status === "paid" ? `${invoice.number} lunas` : `Sisa hutang ${formatRupiah(updated.outstanding)}`, "up");
    onDone();
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label="Dari akun" error={form.errors.accountId}>
        {(p) => (
          <AccountSelect {...p} value={v.accountId} placeholder="Kas atau rekening" onChange={(id) => form.set("accountId", id)} />
        )}
      </Field>
      <Field label="Jumlah" hint={`Sisa hutang ${formatRupiah(invoice.outstanding)}`} error={form.errors.amount}>
        {(p) => <MoneyInput {...p} value={v.amount} onChange={(amount) => form.set("amount", amount)} />}
      </Field>
      <Field label="Tanggal bayar" error={form.errors.date}>
        {(p) => <DateInput {...p} value={v.date} onChange={(e) => form.set("date", e.target.value)} />}
      </Field>
      <div className="flex items-center justify-between gap-3">
        <span className="text-ink-2">Metode</span>
        <Segmented label="Metode" options={paymentMethodLabels} value={v.method} onChange={(method) => form.set("method", method)} />
      </div>
      <Field label="Catatan" hint="Misal: nomor giro atau bukti transfer" error={form.errors.note}>
        {(p) => <Input {...p} value={v.note ?? ""} onChange={(e) => form.set("note", e.target.value)} />}
      </Field>
      {server.message && <p className="text-down">{server.message}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Batal</Button>
        <Button type="submit" variant="primary" disabled={form.submitting}>
          Simpan pembayaran
        </Button>
      </div>
    </form>
  );
}
