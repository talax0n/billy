import { businessDate, stockAdjustmentInput } from "@billy/core";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { Dialog } from "../../components/ui/dialog.tsx";
import { DateInput, Field, Input } from "../../components/ui/field.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";
import { useForm } from "../../lib/form.ts";
import type { ProductRow } from "./products-page.tsx";

/** Writes an `adjustment` stock movement: stock count corrections, damage, opening stock. */
export function StockAdjustDialog({ product, open, onClose }: { product: ProductRow; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Sesuaikan stok" description={`${product.name} ${product.variant}`}>
      {open && <AdjustForm product={product} onDone={onClose} />}
    </Dialog>
  );
}

function AdjustForm({ product, onDone }: { product: ProductRow; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [sign, setSign] = useState<1 | -1>(1);
  const [amount, setAmount] = useState("");
  const form = useForm(stockAdjustmentInput, { qty: 0, note: "", date: businessDate() });

  const setQty = (nextSign: 1 | -1, nextAmount: string) => {
    setSign(nextSign);
    setAmount(nextAmount);
    form.set("qty", nextSign * Number(nextAmount || 0));
  };

  const submit = form.onSubmit(async (input) => {
    const updated = await unwrap(api.products[":id"].adjustments.$post({ param: { id: product.id }, json: input }));
    await queryClient.invalidateQueries({ queryKey: ["products"] });
    toast(`Stok sekarang ${updated.stock} ${updated.unit}`, "up");
    onDone();
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Arah" className="grid grid-cols-2 rounded-lg bg-line-2 p-0.5">
        {([
          [1, "Tambah"],
          [-1, "Kurangi"],
        ] as const).map(([value, label]) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={sign === value}
            onClick={() => setQty(value, amount)}
            className={cx("h-8 rounded-md text-muted", sign === value && "bg-panel font-medium text-ink")}
          >
            {label}
          </button>
        ))}
      </div>
      <Field label={`Jumlah (${product.unit})`} error={form.errors.qty} hint={`Stok sekarang ${product.stock}`}>
        {(p) => (
          <Input
            {...p}
            autoFocus
            inputMode="numeric"
            value={amount}
            onChange={(e) => setQty(sign, e.target.value.replace(/\D/g, ""))}
          />
        )}
      </Field>
      <Field label="Tanggal" error={form.errors.date}>
        {(p) => <DateInput {...p} value={form.values.date ?? ""} onChange={(e) => form.set("date", e.target.value)} />}
      </Field>
      <Field label="Alasan" hint="Misal: hasil stock opname, kaleng penyok" error={form.errors.note}>
        {(p) => <Input {...p} value={form.values.note} onChange={(e) => form.set("note", e.target.value)} />}
      </Field>
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Batal</Button>
        <Button type="submit" variant="primary" disabled={form.submitting}>
          Simpan penyesuaian
        </Button>
      </div>
    </form>
  );
}
