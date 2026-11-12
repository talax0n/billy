import { businessDate, cashEntryInput, transferInput } from "@billy/core";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/ui/button.tsx";
import { Dialog } from "../../components/ui/dialog.tsx";
import { DateInput, Field, Input, MoneyInput } from "../../components/ui/field.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { useForm } from "../../lib/form.ts";
import { AccountSelect } from "./account-select.tsx";

/** Which cash dialog is open on the Kas & Bank page. */
export type CashAction = "in" | "out" | "transfer";

const titles = { in: "Uang masuk lain", out: "Uang keluar lain", transfer: "Transfer antar akun" };
const descriptions = {
  in: "Uang yang masuk bukan dari penjualan, misal modal atau titipan.",
  out: "Uang yang keluar bukan untuk pembelian atau biaya, misal prive.",
  transfer: "Pindah uang antar akun, misal setor kas ke bank.",
};

export function CashDialog({ action, accountId, onClose }: { action: CashAction | null; accountId: string; onClose: () => void }) {
  return (
    <Dialog open={action !== null} onClose={onClose} title={action ? titles[action] : ""} description={action && descriptions[action]}>
      {action === "transfer" && <TransferForm fromAccountId={accountId} onDone={onClose} />}
      {(action === "in" || action === "out") && <CashEntryForm key={action} direction={action} accountId={accountId} onDone={onClose} />}
    </Dialog>
  );
}

function useSaved(onDone: () => void) {
  const queryClient = useQueryClient();
  return async (message: string) => {
    await queryClient.invalidateQueries({ queryKey: ["accounts"] });
    toast(message, "up");
    onDone();
  };
}

function CashEntryForm({ direction, accountId, onDone }: { direction: "in" | "out"; accountId: string; onDone: () => void }) {
  const saved = useSaved(onDone);
  const form = useForm(cashEntryInput, { accountId, date: businessDate(), direction, amount: 0, note: "" });
  const submit = form.onSubmit(async (json) => {
    await unwrap(api.cash.entries.$post({ json }));
    await saved(direction === "in" ? "Uang masuk dicatat" : "Uang keluar dicatat");
  });
  const v = form.values;
  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-2 gap-x-3 gap-y-4">
      <Field label={direction === "in" ? "Masuk ke akun" : "Keluar dari akun"} error={form.errors.accountId}>
        {(p) => <AccountSelect {...p} value={v.accountId} onChange={(id) => form.set("accountId", id)} />}
      </Field>
      <Field label="Tanggal" error={form.errors.date}>
        {(p) => <DateInput {...p} value={v.date} onChange={(e) => form.set("date", e.target.value)} />}
      </Field>
      <Field label="Jumlah" error={form.errors.amount} className="col-span-2">
        {(p) => <MoneyInput {...p} autoFocus value={v.amount} onChange={(value) => form.set("amount", value)} />}
      </Field>
      <Field label="Keterangan" hint="Wajib: dari siapa / untuk apa" error={form.errors.note} className="col-span-2">
        {(p) => <Input {...p} value={v.note} onChange={(e) => form.set("note", e.target.value)} />}
      </Field>
      <div className="col-span-2 flex justify-end gap-2">
        <Button onClick={onDone}>Batal</Button>
        <Button type="submit" variant="primary" disabled={form.submitting}>
          {direction === "in" ? "Catat uang masuk" : "Catat uang keluar"}
        </Button>
      </div>
    </form>
  );
}

function TransferForm({ fromAccountId, onDone }: { fromAccountId: string; onDone: () => void }) {
  const saved = useSaved(onDone);
  const form = useForm(transferInput, { fromAccountId, toAccountId: "", date: businessDate(), amount: 0, note: "", proofUrl: "" });
  const submit = form.onSubmit(async (json) => {
    await unwrap(api.cash.transfers.$post({ json }));
    await saved("Transfer dicatat");
  });
  const v = form.values;
  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-2 gap-x-3 gap-y-4">
      <Field label="Dari akun" error={form.errors.fromAccountId}>
        {(p) => <AccountSelect {...p} value={v.fromAccountId} onChange={(id) => form.set("fromAccountId", id)} />}
      </Field>
      <Field label="Ke akun" error={form.errors.toAccountId}>
        {(p) => <AccountSelect {...p} value={v.toAccountId} onChange={(id) => form.set("toAccountId", id)} />}
      </Field>
      <Field label="Tanggal" error={form.errors.date}>
        {(p) => <DateInput {...p} value={v.date} onChange={(e) => form.set("date", e.target.value)} />}
      </Field>
      <Field label="Jumlah" error={form.errors.amount}>
        {(p) => <MoneyInput {...p} value={v.amount} onChange={(value) => form.set("amount", value)} />}
      </Field>
      <Field label="Catatan" error={form.errors.note} className="col-span-2">
        {(p) => <Input {...p} value={v.note ?? ""} onChange={(e) => form.set("note", e.target.value)} />}
      </Field>
      <Field label="Tautan bukti" hint="Opsional: foto slip atau tangkapan layar" error={form.errors.proofUrl} className="col-span-2">
        {(p) => <Input {...p} type="url" value={v.proofUrl ?? ""} onChange={(e) => form.set("proofUrl", e.target.value)} />}
      </Field>
      <div className="col-span-2 flex justify-end gap-2">
        <Button onClick={onDone}>Batal</Button>
        <Button type="submit" variant="primary" disabled={form.submitting}>
          Simpan transfer
        </Button>
      </div>
    </form>
  );
}
