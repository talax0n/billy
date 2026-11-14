import { type ApprovalInput, posVoidInput } from "@billy/core";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApprovalDialog } from "../components/approval-dialog.tsx";
import { Button } from "../components/ui/button.tsx";
import { Dialog } from "../components/ui/dialog.tsx";
import { Field, Input } from "../components/ui/field.tsx";
import { toast } from "../components/ui/toast.tsx";
import { api, ApiError, unwrap } from "../lib/api.ts";
import { useForm } from "../lib/form.ts";

/**
 * Void a Kasir receipt: asks the reason, then, for anyone but admin, an admin's approval
 * (PIN or remote). The server decides; this only collects what it asks for.
 */
export function VoidSaleDialog({ sale, onClose }: { sale: { id: string; number: string }; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [blocked, setBlocked] = useState<{ reason: string; message: string } | null>(null);
  const form = useForm(posVoidInput, { reason: "" });

  async function send(reason: string, approval?: ApprovalInput) {
    await unwrap(api.pos.sales[":id"].void.$post({ param: { id: sale.id }, json: { reason, ...(approval && { approval }) } }));
    await queryClient.invalidateQueries({ queryKey: ["pos", "sales"] });
    toast(`Struk ${sale.number} dibatalkan`, "up");
    onClose();
  }

  const submit = form.onSubmit(async ({ reason }) => {
    try {
      await send(reason);
    } catch (err) {
      if (err instanceof ApiError && err.approval) setBlocked({ reason, message: err.message });
      else throw err;
    }
  });

  if (blocked) {
    return (
      <ApprovalDialog
        message={blocked.message}
        request={{ action: "pos.void", saleId: sale.id }}
        submit={(approval) => send(blocked.reason, approval)}
        onClose={onClose}
      />
    );
  }
  return (
    <Dialog open onClose={onClose} title={`Batalkan ${sale.number}`} description="Stok dikembalikan dan uang dikeluarkan dari akun lewat baris pembalik.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Alasan" error={form.errors.reason}>
          {(p) => <Input {...p} autoFocus value={form.values.reason} onChange={(e) => form.set("reason", e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Kembali</Button>
          <Button type="submit" variant="danger" disabled={form.submitting}>
            Batalkan struk
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
