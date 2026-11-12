import { type SettingsInput, settingsInput } from "@billy/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/ui/button.tsx";
import { Field, Input } from "../../components/ui/field.tsx";
import { PageBody } from "../../components/ui/page.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { useForm } from "../../lib/form.ts";
import { settingsQuery } from "../../lib/settings.ts";

export function ShopTab() {
  const { data } = useQuery(settingsQuery);
  return <PageBody>{data && <ShopForm initial={data} />}</PageBody>;
}

const fields: { key: Exclude<keyof SettingsInput, "posDeviceCode">; label: string; hint?: string }[] = [
  { key: "shopName", label: "Nama toko" },
  { key: "address", label: "Alamat" },
  { key: "phone", label: "Telepon" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "invoiceBankText", label: "Rekening di faktur", hint: "Contoh: BCA 123-456-7890 a.n. Toko" },
  { key: "invoiceSigner", label: "Penanda tangan faktur" },
  { key: "receiptFooter", label: "Catatan kaki struk" },
];

function ShopForm({ initial }: { initial: SettingsInput }) {
  const queryClient = useQueryClient();
  const form = useForm(settingsInput, initial);
  const submit = form.onSubmit(async (input) => {
    queryClient.setQueryData(settingsQuery.queryKey, await unwrap(api.settings.$put({ json: input })));
    toast("Pengaturan toko disimpan", "up");
  });

  return (
    <form onSubmit={submit} noValidate className="grid max-w-2xl grid-cols-2 gap-x-3 gap-y-4">
      {fields.map(({ key, label, hint }) => (
        <Field key={key} label={label} hint={hint} error={form.errors[key]} className="col-span-2">
          {(p) => <Input {...p} value={form.values[key] ?? ""} onChange={(e) => form.set(key, e.target.value)} />}
        </Field>
      ))}
      <Field label="Kode perangkat kasir" hint="Awalan nomor struk, misal K1" error={form.errors.posDeviceCode}>
        {(p) => <Input {...p} value={form.values.posDeviceCode} onChange={(e) => form.set("posDeviceCode", e.target.value)} />}
      </Field>
      <div className="col-span-2 flex justify-end">
        <Button type="submit" variant="primary" disabled={form.submitting}>
          Simpan pengaturan
        </Button>
      </div>
    </form>
  );
}
