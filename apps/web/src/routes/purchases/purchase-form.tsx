import {
  addDays,
  businessDate,
  computeTotals,
  DomainError,
  formatDate,
  type PurchaseInput,
  purchaseInput,
  rupiah,
  type Totals,
} from "@billy/core";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { Combobox } from "../../components/ui/combobox.tsx";
import { DateInput, Field, Input, MoneyInput } from "../../components/ui/field.tsx";
import { lineTable } from "../../components/ui/line-table.ts";
import { cx } from "../../lib/cx.ts";
import { toast } from "../../components/ui/toast.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { useForm } from "../../lib/form.ts";
import { useServerError } from "./actions.ts";
import { Amount, formatPercent, paymentMethodLabels, Segmented, TotalsPanel } from "./bits.tsx";
import { AccountSelect } from "../cash/account-select.tsx";
import { LookupPicker, lookups, type Product, type Contact, useLookup } from "../../components/lookup-picker.tsx";

type Line = PurchaseInput["lines"][number];

const emptyPurchase = (): PurchaseInput => ({
  supplierId: "",
  supplierInvoiceNumber: "",
  date: businessDate(),
  termsDays: 60,
  discountKind: "none",
  discountValue: 0,
  taxRateBp: 1_100,
  note: "",
  lines: [],
});

/** Display only: the server recomputes every total on save. */
function previewTotals(v: PurchaseInput): { totals: Totals | null; problem?: string } {
  try {
    const lines = v.lines.map((l) => ({ qty: l.qty, unitPrice: rupiah(l.unitCost), discountAmount: rupiah(l.discountAmount) }));
    return { totals: computeTotals(lines, { kind: v.discountKind, value: v.discountValue }, v.taxRateBp) };
  } catch (err) {
    if (err instanceof DomainError) return { totals: null, problem: err.message };
    throw err;
  }
}

/** "11,5" → 1150 basis points. */
const percentToBp = (text: string) => Math.round(Number(text.replace(",", ".") || 0) * 100);

const focusSoon = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());

/**
 * A supplier invoice laid out like the paper one: header, a line table you fill from the
 * keyboard (type a product, Enter, qty, Enter, next product), and read-only totals.
 */
export function PurchaseForm({ onSaved, onCancel }: { onSaved: (id: string) => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const formId = useId();
  const form = useForm(purchaseInput, emptyPurchase());
  const v = form.values;
  const [supplier, setSupplier] = useState<Contact | null>(null);
  const [productsById, setProductsById] = useState<Record<string, Product>>({});
  const [lineDiscounts, setLineDiscounts] = useState(false);
  const [taxText, setTaxText] = useState("11");
  const [discountText, setDiscountText] = useState("");
  const entry = useLookup("product", lookups.product);
  const server = useServerError();
  const { totals, problem } = previewTotals(v);

  const entryId = `${formId}-entry`;
  const qtyId = (index: number) => `${formId}-qty-${index}`;

  const setLine = (index: number, patch: Partial<Line>) =>
    form.set("lines", v.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  function addLine(product: Product) {
    setProductsById((known) => ({ ...known, [product.id]: product }));
    form.set("lines", [...v.lines, { productId: product.id, qty: 1, unitCost: product.costPrice, discountAmount: 0, note: "" }]);
    entry.setQuery("");
    focusSoon(qtyId(v.lines.length));
  }

  const setPayment = (patch: Partial<NonNullable<PurchaseInput["payment"]>>) => form.set("payment", { ...v.payment!, ...patch });

  const submit = form.onSubmit(async (input) => {
    const payment = input.payment && { ...input.payment, date: input.date };
    const saved = await server.guard(unwrap(api.purchases.$post({ json: { ...input, payment } })));
    await Promise.all(["purchases", "products", "stock", "lookup"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    toast(`Faktur ${saved.number} disimpan`, "up");
    onSaved(saved.id);
  });

  const e = form.errors;
  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-6"
      // Enter moves through the line table; only the button saves.
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
      }}
    >
      <section className="grid grid-cols-4 gap-x-3 gap-y-4 max-md:grid-cols-2">
        <Field label="Pemasok" error={e.supplierId} className="col-span-2">
          {(p) => (
            <LookupPicker
              {...p}
              kind="supplier"
              lookup={lookups.supplier}
              value={supplier}
              placeholder="Cari nama atau kode pemasok"
              onChange={(row) => {
                setSupplier(row);
                form.set("supplierId", row?.id ?? "");
                if (row) form.set("termsDays", row.paymentTermsDays);
              }}
            />
          )}
        </Field>
        <Field label="No. faktur pemasok" hint="Nomor di faktur kertas dari pemasok" error={e.supplierInvoiceNumber} className="col-span-2">
          {(p) => <Input {...p} value={v.supplierInvoiceNumber ?? ""} onChange={(ev) => form.set("supplierInvoiceNumber", ev.target.value)} />}
        </Field>
        <Field label="Tanggal faktur" error={e.date}>
          {(p) => <DateInput {...p} value={v.date} onChange={(ev) => form.set("date", ev.target.value)} />}
        </Field>
        <Field label="Termin (hari)" error={e.termsDays}>
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              value={String(v.termsDays)}
              onChange={(ev) => form.set("termsDays", Number(ev.target.value.replace(/\D/g, "").slice(0, 4) || 0))}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-ink-2">Jatuh tempo</span>
          <span className="flex h-9 items-center tabular-nums">{v.date ? formatDate(addDays(v.date, v.termsDays)) : "—"}</span>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Barang</h3>
          <Button variant="ghost" size="sm" onClick={() => setLineDiscounts(!lineDiscounts)}>
            {lineDiscounts ? "Sembunyikan diskon baris" : "+ diskon baris"}
          </Button>
        </div>
        <div className="rounded-xl border border-line">
          <table className={cx("w-full border-collapse", lineTable.table)}>
            <thead className={lineTable.head}>
              <tr className="border-b border-line text-xs text-muted">
                <th className="w-8 py-2 pl-4 text-left font-normal">#</th>
                <th className="px-2 py-2 text-left font-normal">Barang</th>
                <th className="w-24 px-2 py-2 text-right font-normal">Qty</th>
                <th className="w-40 px-2 py-2 text-right font-normal">Harga satuan</th>
                {lineDiscounts && <th className="w-36 px-2 py-2 text-right font-normal">Diskon baris</th>}
                <th className="w-36 px-2 py-2 text-right font-normal">Jumlah</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className={lineTable.body}>
              {v.lines.map((line, i) => {
                const product = productsById[line.productId];
                const lineTotal = totals?.lineTotals[i];
                return (
                  <tr key={i} className={cx("border-b border-line-2 align-top", lineTable.row)}>
                    <td className={cx("py-2.5 pl-4 text-muted tabular-nums", lineTable.index)}>{i + 1}</td>
                    <td className={cx("px-2 py-1.5", lineTable.product)}>
                      <div className="pt-1">
                        {product && lookups.product.label(product)}
                        {product && <span className="ml-1.5 text-muted">/ {product.unit}</span>}
                      </div>
                      <input
                        aria-label={`Catatan baris ${i + 1}`}
                        placeholder="Catatan"
                        className="mt-0.5 w-full bg-transparent text-xs text-ink-2 placeholder:text-faint focus:outline-none"
                        value={line.note ?? ""}
                        onChange={(ev) => setLine(i, { note: ev.target.value })}
                      />
                    </td>
                    <td data-label="Qty" className={cx("px-2 py-1.5", lineTable.field)}>
                      <Input
                        id={qtyId(i)}
                        aria-label={`Qty baris ${i + 1}`}
                        aria-invalid={e[`lines.${i}.qty`] ? true : undefined}
                        inputMode="numeric"
                        className="text-right tabular-nums"
                        value={String(line.qty)}
                        onFocus={(ev) => ev.target.select()}
                        onChange={(ev) => setLine(i, { qty: Number(ev.target.value.replace(/\D/g, "").slice(0, 7) || 0) })}
                        onKeyDown={(ev) => ev.key === "Enter" && focusSoon(entryId)}
                      />
                    </td>
                    <td data-label="Harga satuan" className={cx("px-2 py-1.5", lineTable.field)}>
                      <MoneyInput aria-label={`Harga satuan baris ${i + 1}`} value={line.unitCost} onChange={(value) => setLine(i, { unitCost: value })} />
                    </td>
                    {lineDiscounts && (
                      <td data-label="Diskon" className={cx("px-2 py-1.5", lineTable.field)}>
                        <MoneyInput
                          aria-label={`Diskon baris ${i + 1}`}
                          value={line.discountAmount}
                          onChange={(value) => setLine(i, { discountAmount: value })}
                        />
                      </td>
                    )}
                    <td data-label="Jumlah" className={cx("px-2 py-2.5 text-right tabular-nums", lineTable.field)}>{lineTotal === undefined ? "—" : <Amount value={lineTotal} />}</td>
                    <td className={cx("py-1.5 pr-2", lineTable.remove)}>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Hapus baris ${i + 1}`}
                        onClick={() => form.set("lines", v.lines.filter((_, j) => j !== i))}
                      >
                        <X className="size-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              <tr className={lineTable.row}>
                <td className={cx("py-2.5 pl-4 text-faint tabular-nums", lineTable.index)}>{v.lines.length + 1}</td>
                <td colSpan={lineDiscounts ? 6 : 5} className={cx("px-2 py-1.5", lineTable.wide)}>
                  <Combobox
                    id={entryId}
                    {...(e.lines && { "aria-invalid": true as const })}
                    placeholder="Ketik nama barang, Enter untuk menambah"
                    query={entry.query}
                    onQueryChange={entry.setQuery}
                    options={entry.options}
                    onSelect={(option) => {
                      const product = entry.rows.find((row) => row.id === option.value);
                      if (product) addLine(product);
                    }}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {e.lines && <p className="text-xs text-down">{e.lines}</p>}
      </section>

      <section className="grid grid-cols-[minmax(0,1fr)_340px] gap-8 max-lg:grid-cols-1">
        <div className="flex flex-col gap-4">
          <Field label="Catatan" error={e.note}>
            {(p) => <Input {...p} value={v.note ?? ""} onChange={(ev) => form.set("note", ev.target.value)} />}
          </Field>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={v.payment !== undefined}
              onChange={(ev) =>
                form.set(
                  "payment",
                  ev.target.checked
                    ? { accountId: "", date: v.date, amount: totals?.total ?? 0, method: "transfer", note: "" }
                    : undefined,
                )
              }
            />
            Bayar sekarang
          </label>
          {v.payment && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-4 rounded-xl border border-line p-4">
              <Field label="Dari akun" error={e["payment.accountId"]}>
                {(p) => (
                  <AccountSelect
                    {...p}
                    value={v.payment!.accountId}
                    placeholder="Kas atau rekening"
                    onChange={(accountId) => setPayment({ accountId })}
                  />
                )}
              </Field>
              <Field label="Jumlah dibayar" error={e["payment.amount"]}>
                {(p) => <MoneyInput {...p} value={v.payment!.amount} onChange={(amount) => setPayment({ amount })} />}
              </Field>
              <div className="col-span-2 flex items-center justify-between gap-3">
                <Segmented label="Metode" options={paymentMethodLabels} value={v.payment.method} onChange={(method) => setPayment({ method })} />
                {totals && v.payment.amount !== totals.total && (
                  <Button size="sm" onClick={() => setPayment({ amount: totals.total })}>
                    Bayar lunas
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink-2">Diskon faktur</span>
            <Segmented
              label="Jenis diskon faktur"
              options={{ none: "Tanpa", amount: "Rp", percent: "%" }}
              value={v.discountKind}
              onChange={(kind) => {
                form.set("discountKind", kind);
                form.set("discountValue", 0);
                setDiscountText("");
              }}
            />
          </div>
          {v.discountKind === "amount" && (
            <MoneyInput aria-label="Diskon faktur (Rp)" value={v.discountValue} onChange={(value) => form.set("discountValue", value)} />
          )}
          {v.discountKind === "percent" && (
            <Input
              aria-label="Diskon faktur (%)"
              inputMode="decimal"
              className="text-right tabular-nums"
              placeholder="0"
              value={discountText}
              onChange={(ev) => {
                setDiscountText(ev.target.value);
                form.set("discountValue", percentToBp(ev.target.value));
              }}
            />
          )}
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={`${formId}-ppn`} className="text-ink-2">
              PPN (%)
            </label>
            <div className="w-24">
              <Input
                id={`${formId}-ppn`}
                inputMode="decimal"
                aria-invalid={e.taxRateBp ? true : undefined}
                className="text-right tabular-nums"
                value={taxText}
                onChange={(ev) => {
                  setTaxText(ev.target.value);
                  form.set("taxRateBp", percentToBp(ev.target.value));
                }}
              />
            </div>
          </div>
          <TotalsPanel
            rows={[
              { label: "Subtotal", value: totals?.subtotal ?? null },
              { label: "Diskon faktur", value: totals?.discountAmount ?? null },
              { label: `PPN ${formatPercent(v.taxRateBp)}`, value: totals?.taxAmount ?? null },
              { label: "Total", value: totals?.total ?? null, strong: true },
            ]}
          />
          {problem && <p className="text-xs text-muted">{problem}</p>}
        </div>
      </section>

      <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
        {server.message && <p className="mr-auto text-down">{server.message}</p>}
        <Button onClick={onCancel}>Batal</Button>
        <Button type="submit" variant="primary" disabled={form.submitting}>
          Simpan faktur
        </Button>
      </div>
    </form>
  );
}
