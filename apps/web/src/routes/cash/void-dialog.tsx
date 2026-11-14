import { voidInput } from "@billy/core";
import type { ReactNode } from "react";
import { Button } from "../../components/ui/button.tsx";
import { Dialog } from "../../components/ui/dialog.tsx";
import { Field, Input } from "../../components/ui/field.tsx";
import { useForm } from "../../lib/form.ts";

/** Asks for the reason, then voids. The document stays; its cash side is reversed. */
export function VoidDialog({
  open,
  title,
  description,
  onVoid,
  onClose,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  onVoid: (reason: string) => Promise<unknown>;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      {open && <VoidForm onVoid={onVoid} onClose={onClose} />}
    </Dialog>
  );
}

function VoidForm({ onVoid, onClose }: { onVoid: (reason: string) => Promise<unknown>; onClose: () => void }) {
  const form = useForm(voidInput, { reason: "" });
  const submit = form.onSubmit(async ({ reason }) => {
    await onVoid(reason);
    onClose();
  });
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="text-ink-2">Dokumen tetap tersimpan dengan tanda Dibatalkan, dan uangnya dikembalikan ke akun lewat entri pembatalan.</p>
      <Field label="Alasan pembatalan" error={form.errors.reason}>
        {(p) => <Input {...p} autoFocus value={form.values.reason} onChange={(e) => form.set("reason", e.target.value)} />}
      </Field>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Kembali</Button>
        <Button type="submit" variant="danger" disabled={form.submitting}>
          Batalkan
        </Button>
      </div>
    </form>
  );
}
