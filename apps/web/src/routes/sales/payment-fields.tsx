import { formatRupiah, paymentMethodLabels, paymentMethods, type PaymentMethod, rupiah } from "@billy/core";
import { Field, Input, MoneyInput, Select } from "../../components/ui/field.tsx";
import { AccountSelect } from "../cash/account-select.tsx";

export interface PaymentValues {
  accountId: string;
  amount: number;
  method: PaymentMethod;
  proofUrl?: string | null | undefined;
  note?: string | undefined;
}

/** Account, amount, method and proof link; shared by "Catat pembayaran" and "Bayar sekarang". */
export function PaymentFields({
  values,
  onChange,
  errors,
  errorPrefix = "",
  outstanding,
}: {
  values: PaymentValues;
  onChange: (patch: Partial<PaymentValues>) => void;
  errors: Record<string, string>;
  /** Path of these fields in the form's error map, e.g. `payment.`. */
  errorPrefix?: string;
  outstanding: number;
}) {
  const error = (key: keyof PaymentValues) => errors[`${errorPrefix}${key}`];
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-4">
      <Field label="Masuk ke akun" error={error("accountId")}>
        {(p) => (
          <AccountSelect {...p} value={values.accountId} onChange={(accountId) => onChange({ accountId })} />
        )}
      </Field>
      <Field label="Metode" error={error("method")}>
        {(p) => (
          <Select {...p} value={values.method} onChange={(e) => onChange({ method: e.target.value as PaymentMethod })}>
            {paymentMethods.map((m) => (
              <option key={m} value={m}>
                {paymentMethodLabels[m]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label="Jumlah"
        error={error("amount")}
        hint={`Sisa tagihan ${formatRupiah(rupiah(outstanding))}`}
        className="col-span-2"
      >
        {(p) => <MoneyInput {...p} value={values.amount} onChange={(amount) => onChange({ amount })} />}
      </Field>
      <Field label="Tautan bukti (opsional)" error={error("proofUrl")} className="col-span-2">
        {(p) => (
          <Input {...p} type="url" placeholder="https://…" value={values.proofUrl ?? ""} onChange={(e) => onChange({ proofUrl: e.target.value })} />
        )}
      </Field>
    </div>
  );
}
