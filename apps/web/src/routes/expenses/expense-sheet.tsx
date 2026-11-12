import { businessDate, expenseCategories, expenseInput, formatDate, formatRupiah } from "@billy/core";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useId, useState } from "react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Sheet } from "../../components/ui/dialog.tsx";
import { DateInput, Field, Input, MoneyInput } from "../../components/ui/field.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { useForm } from "../../lib/form.ts";
import { AccountSelect } from "../cash/account-select.tsx";
import { VoidDialog } from "../cash/void-dialog.tsx";
import type { ExpenseRow } from "./expenses-page.tsx";

/** Record a new expense (`expense` null), or read one and void it. */
export function ExpenseSheet({ expense, onClose }: { expense: ExpenseRow | null; onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title={expense ? expense.number : "Catat biaya"} description={expense && formatDate(expense.date)}>
      {expense ? <ExpenseDetail expense={expense} onVoided={onClose} /> : <ExpenseForm onDone={onClose} />}
    </Sheet>
  );
}

function ExpenseForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const categoryListId = useId();
  const form = useForm(expenseInput, { date: businessDate(), accountId: "", category: "", description: "", amount: 0, proofUrl: "" });
  const submit = form.onSubmit(async (json) => {
    const saved = await unwrap(api.expenses.$post({ json }));
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["expenses"] }),
      queryClient.invalidateQueries({ queryKey: ["accounts"] }),
    ]);
    toast(`Biaya ${saved.number} dicatat`, "up");
    onDone();
  });
  const v = form.values;
  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-2 gap-x-3 gap-y-4">
      <Field label="Tanggal" error={form.errors.date}>
        {(p) => <DateInput {...p} value={v.date} onChange={(e) => form.set("date", e.target.value)} />}
      </Field>
      <Field label="Dibayar dari" error={form.errors.accountId}>
        {(p) => <AccountSelect {...p} value={v.accountId} onChange={(id) => form.set("accountId", id)} />}
      </Field>
      <Field label="Kategori" hint="Pilih dari daftar atau ketik sendiri" error={form.errors.category} className="col-span-2">
        {(p) => (
          <>
            <Input {...p} autoFocus list={categoryListId} value={v.category} onChange={(e) => form.set("category", e.target.value)} />
            <datalist id={categoryListId}>
              {expenseCategories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </>
        )}
      </Field>
      <Field label="Keterangan" error={form.errors.description} className="col-span-2">
        {(p) => <Input {...p} value={v.description ?? ""} onChange={(e) => form.set("description", e.target.value)} />}
      </Field>
      <Field label="Jumlah" error={form.errors.amount}>
        {(p) => <MoneyInput {...p} value={v.amount} onChange={(value) => form.set("amount", value)} />}
      </Field>
      <Field label="Tautan bukti" hint="Opsional: foto nota" error={form.errors.proofUrl}>
        {(p) => <Input {...p} type="url" value={v.proofUrl ?? ""} onChange={(e) => form.set("proofUrl", e.target.value)} />}
      </Field>
      <p className="col-span-2 text-muted">Nomor BY-… dibuat otomatis saat disimpan.</p>
      <div className="col-span-2 flex justify-end gap-2">
        <Button onClick={onDone}>Batal</Button>
        <Button type="submit" variant="primary" disabled={form.submitting}>
          Simpan biaya
        </Button>
      </div>
    </form>
  );
}

function ExpenseDetail({ expense, onVoided }: { expense: ExpenseRow; onVoided: () => void }) {
  const queryClient = useQueryClient();
  const [voiding, setVoiding] = useState(false);
  const rows: [string, ReactNode][] = [
    ["Kategori", expense.category],
    ["Keterangan", expense.description || "—"],
    ["Dibayar dari", expense.accountName],
    [
      "Bukti",
      expense.proofUrl ? (
        <a href={expense.proofUrl} target="_blank" rel="noreferrer" className="underline">
          Buka bukti
        </a>
      ) : (
        "—"
      ),
    ],
    ["Dicatat oleh", expense.createdByName],
  ];

  async function voidExpense(reason: string) {
    await unwrap(api.expenses[":id"].void.$post({ param: { id: expense.id }, json: { reason } }));
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["expenses"] }),
      queryClient.invalidateQueries({ queryKey: ["accounts"] }),
    ]);
    toast(`Biaya ${expense.number} di-void`, "up");
    onVoided();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-baseline justify-between">
        <span className={expense.voidedAt ? "text-[27px] font-medium text-muted line-through" : "text-[27px] font-medium"}>
          {formatRupiah(expense.amount)}
        </span>
        {expense.voidedAt && <Badge>Void</Badge>}
      </div>
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        {expense.voidReason && (
          <div className="contents">
            <dt className="text-muted">Alasan void</dt>
            <dd>{expense.voidReason}</dd>
          </div>
        )}
      </dl>
      {!expense.voidedAt && (
        <div className="flex justify-end border-t border-line pt-4">
          <Button variant="danger" onClick={() => setVoiding(true)}>
            Void biaya
          </Button>
        </div>
      )}
      <VoidDialog
        open={voiding}
        title={`Void ${expense.number}`}
        description={`${expense.category} · ${formatRupiah(expense.amount)}`}
        onVoid={voidExpense}
        onClose={() => setVoiding(false)}
      />
    </div>
  );
}
