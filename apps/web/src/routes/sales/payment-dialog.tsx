import { businessDate, salesPaymentInput } from "@billy/core";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/ui/button.tsx";
import { Dialog } from "../../components/ui/dialog.tsx";
import { DateInput, Field } from "../../components/ui/field.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { useForm } from "../../lib/form.ts";
import { PaymentFields } from "./payment-fields.tsx";
import type { InvoiceDetail } from "./queries.ts";

/** Catat pembayaran: payment + cash entry on the server; amount may not exceed the outstanding balance. */
export function PaymentDialog({ invoice, onClose }: { invoice: InvoiceDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const outstanding = invoice.state.outstanding;
  const form = useForm(salesPaymentInput, {
    accountId: "",
    amount: outstanding,
    method: "transfer",
    date: businessDate(),
    proofUrl: "",
    note: "",
  });
  const submit = form.onSubmit(async (input) => {
    await unwrap(api.sales[":id"].payments.$post({ param: { id: invoice.id }, json: input }));
    await queryClient.invalidateQueries({ queryKey: ["sales"] });
    await queryClient.invalidateQueries({ queryKey: ["insights"] });
    toast("Pembayaran dicatat", "up");
    onClose();
  });

  return (
    <Dialog open onClose={onClose} title="Catat pembayaran" description={`${invoice.number} · ${invoice.customer.name}`}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Tanggal bayar" error={form.errors.date}>
          {(p) => <DateInput {...p} value={form.values.date} onChange={(e) => form.set("date", e.target.value)} />}
        </Field>
        <PaymentFields
          values={form.values}
          onChange={(patch) => form.setValues((v) => ({ ...v, ...patch }))}
          errors={form.errors}
          outstanding={outstanding}
        />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Batal</Button>
          <Button type="submit" variant="primary" disabled={form.submitting}>
            Simpan pembayaran
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
