import { voidInput } from "@billy/core";
import type { ReactNode } from "react";
import { Button } from "../../components/ui/button.tsx";
import { Dialog } from "../../components/ui/dialog.tsx";
import { Field, Input } from "../../components/ui/field.tsx";
import { useForm } from "../../lib/form.ts";
import { useServerError } from "./actions.ts";

/**
 * Asks for the reason of a void. `blocked` explains why the void is not possible yet and
 * replaces the form.
 */
export function VoidDialog({
  open,
  title,
  description,
  consequence,
  blocked,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  /** What the void writes, in one sentence. */
  consequence: string;
  blocked?: string | undefined;
  onConfirm: (reason: string) => Promise<unknown>;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      {open &&
        (blocked ? (
          <div className="flex flex-col gap-4">
            <p className="rounded-lg bg-warn-bg px-3 py-2.5 text-warn">{blocked}</p>
            <div className="flex justify-end">
              <Button onClick={onClose}>Kembali</Button>
            </div>
          </div>
        ) : (
          <ReasonForm consequence={consequence} onConfirm={onConfirm} onClose={onClose} />
        ))}
    </Dialog>
  );
}

function ReasonForm({ consequence, onConfirm, onClose }: { consequence: string; onConfirm: (reason: string) => Promise<unknown>; onClose: () => void }) {
  const form = useForm(voidInput, { reason: "" });
  const server = useServerError();
  const submit = form.onSubmit(async ({ reason }) => {
    await server.guard(onConfirm(reason));
    onClose();
  });
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="text-ink-2">{consequence}</p>
      <Field label="Alasan" error={form.errors.reason}>
        {(p) => <Input {...p} autoFocus value={form.values.reason} onChange={(e) => form.set("reason", e.target.value)} />}
      </Field>
      {server.message && <p className="text-down">{server.message}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Kembali</Button>
        <Button type="submit" variant="danger" disabled={form.submitting}>
          Batalkan
        </Button>
      </div>
    </form>
  );
}
