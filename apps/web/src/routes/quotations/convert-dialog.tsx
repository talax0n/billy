import { businessDate, type QuotationConvertInput, quotationConvertInput } from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ApprovalDialog } from "../../components/approval-dialog.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Dialog } from "../../components/ui/dialog.tsx";
import { DateInput, Field, Input } from "../../components/ui/field.tsx";
import { api, ApiError, unwrap } from "../../lib/api.ts";
import { useForm } from "../../lib/form.ts";
import type { QuotationDetail } from "./queries.ts";

/** Asks for the faktur date and terms. A 403 with an approval hint opens the approval dialog and retries with it. */
export function ConvertDialog({
  quotation,
  onClose,
  onConverted,
}: {
  quotation: QuotationDetail;
  onClose: () => void;
  onConverted: (invoiceId: string) => Promise<void>;
}) {
  const customer = useQuery({
    queryKey: ["contacts", quotation.customerId],
    queryFn: () => unwrap(api.contacts[":id"].$get({ param: { id: quotation.customerId } })),
  });
  const form = useForm(quotationConvertInput, { date: businessDate(), termsDays: 0 });
  const [termsTouched, setTermsTouched] = useState(false);
  const [blocked, setBlocked] = useState<{ input: QuotationConvertInput; message: string } | null>(null);
  const termsDays = termsTouched ? form.values.termsDays : (customer.data?.paymentTermsDays ?? 0);

  const convert = async (input: QuotationConvertInput) => {
    const invoice = await unwrap(api.quotations[":id"].convert.$post({ param: { id: quotation.id }, json: input }));
    await onConverted(invoice.id);
  };
  const submit = form.onSubmit(async ({ date }) => {
    const input = { date, termsDays };
    try {
      await convert(input);
    } catch (err) {
      if (!(err instanceof ApiError && err.approval)) throw err;
      setBlocked({ input, message: err.message });
    }
  });

  return (
    <Dialog open onClose={onClose} title="Jadikan faktur" description={`${quotation.number} jadi faktur penjualan. Stok berkurang saat faktur dibuat.`}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Tanggal faktur" error={form.errors.date}>
          {(p) => <DateInput {...p} value={form.values.date} onChange={(e) => form.set("date", e.target.value)} />}
        </Field>
        <Field label="Tempo (hari)" error={form.errors.termsDays}>
          {(p) => (
            <Input
              {...p}
              type="number"
              min={0}
              max={365}
              value={termsDays}
              onChange={(e) => {
                setTermsTouched(true);
                form.set("termsDays", Math.max(0, Math.trunc(Number(e.target.value))));
              }}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Batal</Button>
          <Button type="submit" variant="primary" disabled={form.submitting}>
            Jadikan faktur
          </Button>
        </div>
      </form>
      {blocked && (
        <ApprovalDialog
          message={blocked.message}
          request={{ action: "quotation.convert", quotationId: quotation.id, convert: blocked.input }}
          submit={(approval) => convert({ ...blocked.input, approval })}
          onClose={() => setBlocked(null)}
        />
      )}
    </Dialog>
  );
}
