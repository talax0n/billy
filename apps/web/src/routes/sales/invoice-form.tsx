import {
  addDays,
  businessDate,
  computeTotals,
  type DiscountKind,
  DomainError,
  fieldErrors,
  formatDate,
  formatRupiah,
  rupiah,
  salesInvoiceInput,
  type Totals,
} from "@billy/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { type FormEvent, type KeyboardEvent, type ReactNode, useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { Combobox } from "../../components/ui/combobox.tsx";
import { controlClass, DateInput, Field, Input, MoneyInput, Select } from "../../components/ui/field.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, ApiError, unwrap } from "../../lib/api.ts";
import { lineTable } from "../../components/ui/line-table.ts";
import { cx } from "../../lib/cx.ts";
import { type Contact, LookupPicker, lookups } from "../../components/lookup-picker.tsx";
import { PaymentFields, type PaymentValues } from "./payment-fields.tsx";

interface LineProduct {
  id: string;
  name: string;
  variant: string;
  unit: string;
  stock: number;
}

interface Line {
  key: number;
  product: LineProduct | null;
  qty: number;
  unitPrice: number;
  discountAmount: number;
  note: string;
}

let nextKey = 1;
const blankLine = (): Line => ({ key: nextKey++, product: null, qty: 1, unitPrice: 0, discountAmount: 0, note: "" });

/** Focus after React has rendered the element (a new line, or the qty cell after picking a product). */
const focusLater = (id: string) =>
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (el instanceof HTMLInputElement) {
      el.focus();
      el.select();
    }
  });

const percentFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

/** "2,5" → 250 basis points. */
const parsePercent = (text: string) => Math.round(Number(text.replace(",", ".")) * 100) || 0;

function tryTotals(lines: Line[], kind: DiscountKind, value: number): { totals: Totals | null; error: string | null } {
  if (lines.length === 0) return { totals: null, error: null };
  try {
    return { totals: computeTotals(lines.map((l) => ({ ...l, unitPrice: rupiah(l.unitPrice), discountAmount: rupiah(l.discountAmount) })), { kind, value }), error: null };
  } catch (err) {
    if (err instanceof DomainError) return { totals: null, error: err.message };
    throw err;
  }
}

/**
 * The invoice as a document: header (customer, date, terms), a keyboard-first line table and a
 * read-only totals panel. The server recomputes every number on save.
 */
export function InvoiceForm({ onSaved }: { onSaved: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [customer, setCustomer] = useState<Contact | null>(null);
  const [date, setDate] = useState(businessDate());
  const [termsDays, setTermsDays] = useState(0);
  const [lines, setLines] = useState<Line[]>(() => [blankLine()]);
  const [showLineDiscount, setShowLineDiscount] = useState(false);
  const [discountKind, setDiscountKind] = useState<DiscountKind>("none");
  const [discountText, setDiscountText] = useState("");
  const [discountAmount, setDiscountAmount] = useState(0);
  const [note, setNote] = useState("");
  const [payment, setPayment] = useState<PaymentValues | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const filled = lines.filter((l) => l.product);
  const discountValue = discountKind === "percent" ? parsePercent(discountText) : discountKind === "amount" ? discountAmount : 0;
  const { totals, error: totalsError } = tryTotals(filled, discountKind, discountValue);

  const updateLine = (key: number, patch: Partial<Line>) =>
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function nextLine(index: number) {
    const following = lines[index + 1];
    if (following) return focusLater(`line-${following.key}-product`);
    const line = blankLine();
    setLines((all) => [...all, line]);
    focusLater(`line-${line.key}-product`);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = salesInvoiceInput.safeParse({
      customerId: customer?.id ?? "",
      date,
      termsDays,
      discountKind,
      discountValue,
      note,
      lines: filled.map((l) => ({
        productId: l.product!.id,
        qty: l.qty,
        unitPrice: l.unitPrice,
        discountAmount: l.discountAmount,
        note: l.note,
      })),
      payment,
    });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const saved = await unwrap(api.sales.$post({ json: parsed.data }));
      await queryClient.invalidateQueries({ queryKey: ["sales"] });
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      toast(`${saved.number} disimpan`, "up");
      onSaved(saved.id);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setErrors(err.fields);
      toast(err.message, "down");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <section className="grid grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] gap-3 max-md:grid-cols-2 max-md:[&>:first-child]:col-span-2">
        <Field label="Pelanggan" error={errors.customerId}>
          {(p) => (
            <LookupPicker
              {...p}
              kind="customer"
              lookup={lookups.customer}
              value={customer}
              placeholder="Cari pelanggan…"
              onChange={(c) => {
                setCustomer(c);
                if (c) setTermsDays(c.paymentTermsDays);
              }}
            />
          )}
        </Field>
        <Field label="Tanggal" error={errors.date}>
          {(p) => <DateInput {...p} value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label="Tempo (hari)" error={errors.termsDays}>
          {(p) => (
            <Input
              {...p}
              type="number"
              min={0}
              max={365}
              value={termsDays}
              onChange={(e) => setTermsDays(Math.max(0, Math.trunc(Number(e.target.value))))}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-ink-2">Jatuh tempo</span>
          <output className="flex h-9 items-center text-ink tabular-nums">{date ? formatDate(addDays(date, termsDays)) : "—"}</output>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className={cx("w-full min-w-[640px] border-collapse", lineTable.table)}>
            <thead className={lineTable.head}>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="w-8 px-3 py-2 font-normal">#</th>
                <th className="px-2 py-2 font-normal">Barang</th>
                <th className="w-20 px-2 py-2 text-right font-normal">Jumlah</th>
                <th className="w-36 px-2 py-2 text-right font-normal">Harga</th>
                {showLineDiscount && <th className="w-32 px-2 py-2 text-right font-normal">Diskon</th>}
                <th className="w-32 px-3 py-2 text-right font-normal">Total</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className={lineTable.body}>
              {lines.map((line, index) => (
                <LineRow
                  key={line.key}
                  line={line}
                  index={index}
                  showDiscount={showLineDiscount}
                  lineTotal={line.product ? (totals?.lineTotals[filled.indexOf(line)] ?? null) : null}
                  errors={errors}
                  errorIndex={filled.indexOf(line)}
                  onChange={(patch) => updateLine(line.key, patch)}
                  onNext={() => nextLine(index)}
                  onRemove={
                    lines.length > 1 ? () => setLines((all) => all.filter((l) => l.key !== line.key)) : undefined
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => nextLine(lines.length - 1)}>
            <Plus className="size-3.5" />
            Baris
          </Button>
          <Button size="sm" variant="ghost" aria-pressed={showLineDiscount} onClick={() => setShowLineDiscount((v) => !v)}>
            {showLineDiscount ? "Sembunyikan diskon baris" : "+ diskon baris"}
          </Button>
          <span className="ml-auto text-xs text-muted max-md:hidden">Ketik nama barang, Enter untuk jumlah, Enter lagi untuk baris baru</span>
        </div>
        {errors.lines && <p className="text-xs text-down">{errors.lines}</p>}
      </section>

      <section className="grid grid-cols-[minmax(0,1fr)_320px] gap-6 max-lg:grid-cols-1">
        <div className="flex flex-col gap-4">
          <Field label="Catatan faktur" error={errors.note}>
            {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={payment !== null}
              onChange={(e) =>
                setPayment(
                  e.target.checked ? { accountId: "", amount: totals?.total ?? 0, method: "cash", proofUrl: "", note: "" } : null,
                )
              }
            />
            Bayar sekarang
          </label>
          {payment && (
            <PaymentFields
              values={payment}
              onChange={(patch) => setPayment((p) => p && { ...p, ...patch })}
              errors={errors}
              errorPrefix="payment."
              outstanding={totals?.total ?? 0}
            />
          )}
        </div>
        <TotalsPanel
          totals={totals}
          error={totalsError}
          discountKind={discountKind}
          discountInput={
            <div className="flex gap-2">
              <Select
                className="w-28 shrink-0"
                aria-label="Jenis diskon faktur"
                value={discountKind}
                onChange={(e) => setDiscountKind(e.target.value as DiscountKind)}
              >
                <option value="none">Tanpa</option>
                <option value="percent">Persen</option>
                <option value="amount">Rupiah</option>
              </Select>
              {discountKind === "percent" && (
                <div className="relative flex-1">
                  <input
                    aria-label="Diskon persen"
                    inputMode="decimal"
                    className={cx(controlClass, "pr-7 text-right tabular-nums")}
                    value={discountText}
                    placeholder="0"
                    onChange={(e) => setDiscountText(e.target.value.replace(/[^\d,]/g, ""))}
                    onBlur={() => discountText && setDiscountText(percentFormat.format(parsePercent(discountText) / 100))}
                  />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-faint">%</span>
                </div>
              )}
              {discountKind === "amount" && (
                <MoneyInput aria-label="Diskon rupiah" className="flex-1" value={discountAmount} onChange={setDiscountAmount} />
              )}
            </div>
          }
        />
      </section>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={submitting}>
          Simpan faktur
        </Button>
      </div>
    </form>
  );
}

function LineRow({
  line,
  index,
  showDiscount,
  lineTotal,
  errors,
  errorIndex,
  onChange,
  onNext,
  onRemove,
}: {
  line: Line;
  index: number;
  showDiscount: boolean;
  lineTotal: number | null;
  errors: Record<string, string>;
  errorIndex: number;
  onChange: (patch: Partial<Line>) => void;
  onNext: () => void;
  onRemove: (() => void) | undefined;
}) {
  const [query, setQuery] = useState("");
  const products = useQuery({
    queryKey: ["products", "lookup", query],
    queryFn: () => unwrap(api.products.$get({ query: { q: query, pageSize: "8" } })),
    enabled: query.trim().length > 0,
  });
  const options = (products.data?.rows ?? []).filter((p) => p.active);
  const error = (key: string) => (errorIndex >= 0 ? errors[`lines.${errorIndex}.${key}`] : undefined);
  const enterTo = (next: () => void) => (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      next();
    }
  };
  const cellInput = cx(controlClass, "h-8 text-right tabular-nums");

  return (
    <tr className={cx("border-b border-line-2 align-top last:border-b-0", lineTable.row)}>
      <td className={cx("px-3 py-2.5 text-muted tabular-nums", lineTable.index)}>{index + 1}</td>
      <td className={cx("px-2 py-1.5", lineTable.product)}>
        {line.product ? (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              className="flex h-8 items-center gap-2 text-left"
              title="Ganti barang"
              onClick={() => {
                onChange({ product: null });
                focusLater(`line-${line.key}-product`);
              }}
            >
              {line.product.name}
              <span className="text-muted">{line.product.variant}</span>
              <span className={cx("text-xs", line.product.stock < line.qty ? "text-warn" : "text-faint")}>
                stok {line.product.stock} {line.product.unit}
              </span>
            </button>
            <input
              aria-label={`Catatan baris ${index + 1}`}
              className="h-6 bg-transparent text-xs text-ink-2 placeholder:text-faint focus:outline-none"
              placeholder="Catatan / kode warna tinting"
              value={line.note}
              onChange={(e) => onChange({ note: e.target.value })}
              onKeyDown={enterTo(onNext)}
            />
          </div>
        ) : (
          <Combobox
            id={`line-${line.key}-product`}
            query={query}
            onQueryChange={setQuery}
            placeholder="Ketik nama barang…"
            {...(error("productId") && { "aria-invalid": true as const })}
            options={options.map((p) => ({
              value: p.id,
              label: `${p.name} ${p.variant}`.trim(),
              hint: `${formatRupiah(p.sellPrice)} · stok ${p.stock}`,
            }))}
            onSelect={(option) => {
              const p = options.find((o) => o.id === option.value);
              if (!p) return;
              onChange({ product: p, unitPrice: p.sellPrice });
              setQuery("");
              focusLater(`line-${line.key}-qty`);
            }}
          />
        )}
      </td>
      <td data-label="Jumlah" className={cx("px-2 py-1.5", lineTable.field)}>
        <input
          id={`line-${line.key}-qty`}
          aria-label={`Jumlah baris ${index + 1}`}
          aria-invalid={error("qty") ? true : undefined}
          inputMode="numeric"
          className={cellInput}
          value={line.qty || ""}
          onChange={(e) => onChange({ qty: Number(e.target.value.replace(/\D/g, "")) })}
          onKeyDown={enterTo(onNext)}
        />
      </td>
      <td data-label="Harga" className={cx("px-2 py-1.5", lineTable.field)}>
        <MoneyInput
          aria-label={`Harga baris ${index + 1}`}
          className="[&_input]:h-8"
          value={line.unitPrice}
          onChange={(unitPrice) => onChange({ unitPrice })}
          onKeyDown={enterTo(onNext)}
        />
      </td>
      {showDiscount && (
        <td data-label="Diskon" className={cx("px-2 py-1.5", lineTable.field)}>
          <MoneyInput
            aria-label={`Diskon baris ${index + 1}`}
            className="[&_input]:h-8"
            value={line.discountAmount}
            onChange={(discountAmount) => onChange({ discountAmount })}
            onKeyDown={enterTo(onNext)}
          />
        </td>
      )}
      <td data-label="Total" className={cx("px-3 py-2.5 text-right tabular-nums", lineTable.field)}>{lineTotal === null ? <span className="text-faint">—</span> : formatRupiah(rupiah(lineTotal))}</td>
      <td className={cx("py-1.5 pr-2", lineTable.remove)}>
        {onRemove && (
          <Button size="icon" variant="ghost" aria-label={`Hapus baris ${index + 1}`} onClick={onRemove}>
            <X className="size-4" />
          </Button>
        )}
      </td>
    </tr>
  );
}

function TotalsPanel({
  totals,
  error,
  discountKind,
  discountInput,
}: {
  totals: Totals | null;
  error: string | null;
  discountKind: DiscountKind;
  discountInput: ReactNode;
}) {
  const money = (value: number | undefined) => (value === undefined ? "—" : formatRupiah(rupiah(value)));
  return (
    <aside aria-label="Total" className="flex flex-col gap-3 rounded-xl border border-line bg-line-2/40 p-4">
      <Row label="Subtotal" value={money(totals?.subtotal)} />
      <div className="flex flex-col gap-2">
        <span className="text-ink-2">Diskon faktur</span>
        {discountInput}
        {discountKind !== "none" && <Row label="Potongan" value={totals ? `− ${money(totals.discountAmount)}` : "—"} />}
      </div>
      <div className="border-t border-line pt-3">
        <Row label="Total" value={money(totals?.total)} strong />
      </div>
      {error && <p className="text-xs text-down">{error}</p>}
    </aside>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cx("flex items-baseline justify-between gap-3", strong && "text-lg font-medium")}>
      <span className={strong ? "text-ink" : "text-ink-2"}>{label}</span>
      <output className="tabular-nums">{value}</output>
    </div>
  );
}
