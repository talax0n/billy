import { businessDate, expenseCategories, expenseInput, formatDate, formatRupiah } from "@billy/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { InferResponseType } from "hono/client";
import { Pencil } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { z } from "zod";
import { RevisionLinks } from "../../components/revision-links.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Sheet } from "../../components/ui/dialog.tsx";
import { DateInput, Field, Input, MoneyInput } from "../../components/ui/field.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { useForm } from "../../lib/form.ts";
import { AccountSelect } from "../cash/account-select.tsx";
import { VoidDialog } from "../cash/void-dialog.tsx";

type Expense = InferResponseType<(typeof api.expenses)[":id"]["$get"], 200>;

/** The create fields plus the reason an Ubah needs; the server requires it on an edit. */
const expenseForm = expenseInput.extend({ reason: z.string().trim().max(500).optional() });

/** Record a new expense (`expenseId` null), or read one, correct it (Ubah) or void it. */
export function ExpenseSheet({ expenseId, onClose }: { expenseId: string | null; onClose: () => void }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const expense = useQuery({
    queryKey: ["expenses", expenseId],
    queryFn: () => unwrap(api.expenses[":id"].$get({ param: { id: expenseId! } })),
    enabled: expenseId !== null,
  });
  const e = expense.data;
  const title = expenseId === null ? "Catat biaya" : e ? (editing ? `Ubah ${e.number}` : e.number) : "Memuat…";
  return (
    <Sheet open onClose={onClose} title={title} description={e && formatDate(e.date)}>
      {expenseId === null ? (
        <ExpenseForm onDone={onClose} />
      ) : (
        e &&
        (editing ? (
          <ExpenseForm
            edit={e}
            onDone={(newId) => {
              setEditing(false);
              if (newId) void navigate({ to: "/biaya", search: { id: newId } });
            }}
          />
        ) : (
          <ExpenseDetail expense={e} onVoided={onClose} onEdit={() => setEditing(true)} />
        ))
      )}
    </Sheet>
  );
}

function ExpenseForm({ edit, onDone }: { edit?: Expense; onDone: (savedId?: string) => void }) {
  const queryClient = useQueryClient();
  const categoryListId = useId();
  const form = useForm(
    expenseForm,
    edit
      ? { date: edit.date, accountId: edit.accountId, category: edit.category, description: edit.description, amount: edit.amount, proofUrl: edit.proofUrl ?? "", reason: "" }
      : { date: businessDate(), accountId: "", category: "", description: "", amount: 0, proofUrl: "" },
  );
  const submit = form.onSubmit(async ({ reason, ...json }) => {
    const saved = edit
      ? await unwrap(api.expenses[":id"].edit.$post({ param: { id: edit.id }, json: { ...json, reason: reason ?? "" } }))
      : await unwrap(api.expenses.$post({ json }));
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["expenses"] }),
      queryClient.invalidateQueries({ queryKey: ["accounts"] }),
    ]);
    toast(edit ? `${edit.number} diubah menjadi ${saved.number}` : `Biaya ${saved.number} dicatat`, "up");
    onDone(saved.id);
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
      {edit && (
        <Field label="Alasan perubahan" error={form.errors.reason} className="col-span-2">
          {(p) => <Input {...p} value={v.reason ?? ""} onChange={(e) => form.set("reason", e.target.value)} />}
        </Field>
      )}
      <p className="col-span-2 text-muted">
        {edit ? `${edit.number} dibatalkan dan diganti biaya baru bernomor ${edit.number}/R….` : "Nomor BY-… dibuat otomatis saat disimpan."}
      </p>
      <div className="col-span-2 flex justify-end gap-2">
        <Button onClick={() => onDone()}>Batal</Button>
        <Button type="submit" variant="primary" disabled={form.submitting}>
          {edit ? "Simpan perubahan" : "Simpan biaya"}
        </Button>
      </div>
    </form>
  );
}

function ExpenseDetail({ expense, onVoided, onEdit }: { expense: Expense; onVoided: () => void; onEdit: () => void }) {
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
    toast(`Biaya ${expense.number} dibatalkan`, "up");
    onVoided();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-baseline justify-between">
        <span className={expense.voidedAt ? "text-[27px] font-medium text-muted line-through" : "text-[27px] font-medium"}>
          {formatRupiah(expense.amount)}
        </span>
        {expense.voidedAt && <Badge>Dibatalkan</Badge>}
      </div>
      {(expense.revisionOf || expense.revisedBy) && (
        <div className="flex flex-wrap gap-3">
          <RevisionLinks path="/biaya" revisionOf={expense.revisionOf} revisedBy={expense.revisedBy} />
        </div>
      )}
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        {expense.voidReason && (
          <div className="contents">
            <dt className="text-muted">Alasan pembatalan</dt>
            <dd>{expense.voidReason}</dd>
          </div>
        )}
      </dl>
      {!expense.voidedAt && (
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button onClick={onEdit}>
            <Pencil className="size-3.5" />
            Ubah
          </Button>
          <Button variant="danger" onClick={() => setVoiding(true)}>
            Batalkan biaya
          </Button>
        </div>
      )}
      <VoidDialog
        open={voiding}
        title={`Batalkan ${expense.number}`}
        description={`${expense.category} · ${formatRupiah(expense.amount)}`}
        onVoid={voidExpense}
        onClose={() => setVoiding(false)}
      />
    </div>
  );
}
