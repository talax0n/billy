import { type SettingsInput, settingsInput } from "@billy/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { controlClass, Field, Input } from "../../components/ui/field.tsx";
import { PageBody, PageHeader } from "../../components/ui/page.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, ApiError, unwrap } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";
import { useForm } from "../../lib/form.ts";
import { settingsQuery } from "../../lib/settings.ts";
import { SettingsSection } from "./section.tsx";

export function ShopPage() {
  const { data } = useQuery(settingsQuery);
  return (
    <>
      <PageHeader title="Toko" />
      <PageBody className="max-w-2xl gap-8">
        <SettingsSection title="Data toko" description="Tampil di kepala faktur, struk kasir, dan menu samping.">
          {data && <ShopForm initial={data} />}
        </SettingsSection>
        <SettingsSection
          title="Pengumuman untuk semua staf"
          description={
            <>
              Muncul sekali saat staf masuk aplikasi, dan muncul lagi setiap kali diubah.
              {data?.announcementUpdatedAt && data.announcement && ` Terakhir diubah ${stamp.format(new Date(data.announcementUpdatedAt))}.`}
            </>
          }
        >
          {data && <AnnouncementForm initial={data.announcement} />}
        </SettingsSection>
      </PageBody>
    </>
  );
}

const stamp = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });

/** Shown to every staff member when they sign in, and again after it changes. */
function AnnouncementForm({ initial }: { initial: string }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  async function save(announcement: string) {
    setSaving(true);
    try {
      const saved = await unwrap(api.settings.announcement.$put({ json: { announcement } }));
      queryClient.setQueryData(settingsQuery.queryKey, (s) => s && { ...s, ...saved });
      setText(saved.announcement);
      toast(saved.announcement ? "Pengumuman disimpan. Staf melihatnya saat masuk." : "Pengumuman dihapus", "up");
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      toast(err.message, "down");
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <textarea
        aria-label="Pengumuman untuk semua staf"
        rows={3}
        maxLength={1000}
        placeholder="Misal: Sabtu ini stok opname, toko tutup jam 15.00."
        className={cx(controlClass, "h-auto py-2")}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        {initial && (
          <Button variant="danger" disabled={saving} onClick={() => void save("")}>
            Hapus pengumuman
          </Button>
        )}
        <Button variant="primary" disabled={saving || text.trim() === initial} onClick={() => void save(text)}>
          Simpan pengumuman
        </Button>
      </div>
    </>
  );
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
    toast("Data toko disimpan", "up");
  });

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-2 gap-x-3 gap-y-4">
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
          Simpan data toko
        </Button>
      </div>
    </form>
  );
}
