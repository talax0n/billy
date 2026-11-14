import { voidInput } from "@billy/core";
import type { ReactNode } from "react";
import { Button } from "../../components/ui/button.tsx";
import { Dialog } from "../../components/ui/dialog.tsx";
import { Field, Input } from "../../components/ui/field.tsx";
import { useForm } from "../../lib/form.ts";

/** Asks for the void reason; the void itself writes the reversal rows on the server. */
export function VoidDialog({
  title,
  description,
  onClose,
  onConfirm,
}: {
  title: string;
  description: ReactNode;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<unknown>;
}) {
  const form = useForm(voidInput, { reason: "" });
  const submit = form.onSubmit(async ({ reason }) => {
    await onConfirm(reason);
    onClose();
  });
  return (
    <Dialog open onClose={onClose} title={title} description={description}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Alasan" error={form.errors.reason}>
          {(p) => <Input {...p} autoFocus value={form.values.reason} onChange={(e) => form.set("reason", e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Kembali</Button>
          <Button type="submit" variant="danger" disabled={form.submitting}>
            Batalkan
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
