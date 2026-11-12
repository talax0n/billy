import { type ContactInput, contactInput, type ContactKind, contactKindLabels, contactKinds } from "@billy/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { Sheet } from "../../components/ui/dialog.tsx";
import { Field, Input, Select } from "../../components/ui/field.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { useForm } from "../../lib/form.ts";

const emptyContact = (kind: ContactKind): ContactInput => ({
  code: "",
  name: "",
  kind,
  phone: "",
  email: "",
  address: "",
  taxId: "",
  paymentTermsDays: 0,
  active: true,
});

/** Create (`contactId` null) or edit a contact. */
export function ContactSheet({
  contactId,
  defaultKind,
  onClose,
}: {
  contactId: string | null;
  defaultKind: ContactKind;
  onClose: () => void;
}) {
  const contact = useQuery({
    queryKey: ["contacts", contactId],
    queryFn: () => unwrap(api.contacts[":id"].$get({ param: { id: contactId! } })),
    enabled: contactId !== null,
  });

  return (
    <Sheet
      open
      onClose={onClose}
      title={contactId ? (contact.data?.name ?? "Memuat…") : "Kontak baru"}
      description={contact.data?.code}
    >
      {contactId === null ? (
        <ContactForm initial={emptyContact(defaultKind)} onDone={onClose} />
      ) : (
        contact.data && <ContactForm key={contact.data.id} id={contact.data.id} initial={contact.data} onDone={onClose} />
      )}
    </Sheet>
  );
}

function ContactForm({ id, initial, onDone }: { id?: string; initial: ContactInput; onDone: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm(contactInput, initial);
  const v = form.values;
  // A new contact gets the next free code of its kind until the user types their own.
  const [codeEdited, setCodeEdited] = useState(Boolean(id));
  const suggestion = useQuery({
    queryKey: ["contacts", "next-code", v.kind],
    queryFn: () => unwrap(api.contacts["next-code"].$get({ query: { kind: v.kind } })),
    enabled: !codeEdited,
  });
  const suggestedCode = suggestion.data?.code;
  useEffect(() => {
    if (!codeEdited && suggestedCode) form.set("code", suggestedCode);
  }, [codeEdited, suggestedCode]);

  const submit = form.onSubmit(async (json) => {
    if (id) await unwrap(api.contacts[":id"].$put({ param: { id }, json }));
    else await unwrap(api.contacts.$post({ json }));
    await queryClient.invalidateQueries({ queryKey: ["contacts"] });
    toast("Kontak disimpan", "up");
    onDone();
  });

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-2 gap-x-3 gap-y-4">
      <Field label="Jenis" error={form.errors.kind}>
        {(p) => (
          <Select {...p} value={v.kind} onChange={(e) => form.set("kind", e.target.value as ContactKind)}>
            {contactKinds.map((kind) => (
              <option key={kind} value={kind}>
                {contactKindLabels[kind]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Kode" hint={codeEdited ? undefined : "Nomor berikutnya, boleh diganti"} error={form.errors.code}>
        {(p) => (
          <Input
            {...p}
            value={v.code}
            onChange={(e) => {
              setCodeEdited(true);
              form.set("code", e.target.value);
            }}
          />
        )}
      </Field>
      <Field label="Nama" error={form.errors.name} className="col-span-2">
        {(p) => <Input {...p} autoFocus={!id} value={v.name} onChange={(e) => form.set("name", e.target.value)} />}
      </Field>
      <Field label="Telepon / WhatsApp" error={form.errors.phone}>
        {(p) => <Input {...p} type="tel" value={v.phone ?? ""} onChange={(e) => form.set("phone", e.target.value)} />}
      </Field>
      <Field label="Email" error={form.errors.email}>
        {(p) => <Input {...p} type="email" value={v.email ?? ""} onChange={(e) => form.set("email", e.target.value)} />}
      </Field>
      <Field label="Alamat" error={form.errors.address} className="col-span-2">
        {(p) => <Input {...p} value={v.address ?? ""} onChange={(e) => form.set("address", e.target.value)} />}
      </Field>
      <Field label="NPWP" error={form.errors.taxId}>
        {(p) => <Input {...p} value={v.taxId ?? ""} onChange={(e) => form.set("taxId", e.target.value)} />}
      </Field>
      <Field label="Tempo pembayaran (hari)" hint="Jatuh tempo bawaan di faktur. 0 = tunai" error={form.errors.paymentTermsDays}>
        {(p) => (
          <Input
            {...p}
            type="number"
            min={0}
            value={v.paymentTermsDays ?? 0}
            onChange={(e) => form.set("paymentTermsDays", Number(e.target.value))}
          />
        )}
      </Field>
      <label className="col-span-2 flex items-center gap-2">
        <input type="checkbox" checked={v.active ?? true} onChange={(e) => form.set("active", e.target.checked)} />
        Aktif (muncul di pilihan faktur)
      </label>
      <div className="col-span-2 flex justify-end">
        <Button type="submit" variant="primary" disabled={form.submitting}>
          {id ? "Simpan perubahan" : "Simpan kontak"}
        </Button>
      </div>
    </form>
  );
}
