import {
  addDays,
  applyBasisPoints,
  type ApprovalInput,
  type ApprovalRequestInput,
  businessDate,
  computeTotals,
  daysBetween,
  type DiscountKind,
  DomainError,
  fieldErrors,
  formatDate,
  formatRupiah,
  QUOTATION_VALID_DAYS,
  quotationInput,
  type QuotationInput,
  rupiah,
  salesInvoiceEditInput,
  type SalesInvoiceEditInput,
  salesInvoiceInput,
  type SalesInvoiceInput,
  type Totals,
} from "@billy/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { type FormEvent, type KeyboardEvent, type ReactNode, useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { Combobox } from "../../components/ui/combobox.tsx";
import { controlClass, DateInput, Field, Input, MoneyInput, Select } from "../../components/ui/field.tsx";
import { ApprovalDialog } from "../../components/approval-dialog.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, ApiError, unwrap } from "../../lib/api.ts";
import { lineTable } from "../../components/ui/line-table.ts";
import { cx } from "../../lib/cx.ts";
import { type Contact, LookupPicker, lookups } from "../../components/lookup-picker.tsx";
import { PaymentFields, type PaymentValues } from "./payment-fields.tsx";
import type { InvoiceDetail } from "./queries.ts";

interface LineProduct {
  id: string;
  name: string;
  variant: string;
  unit: string;
  /** Unknown for a line loaded from a saved invoice until the product is picked again. */
  stock?: number;
}

interface Line {
  key: number;
  product: LineProduct | null;
  qty: number;
  unitPrice: number;
  discountAmount: number;
  /** Set while the line discount is typed as a percent ("2,5"); null when typed in rupiah. */
  discountPercent: string | null;
  note: string;
}

let nextKey = 1;
const blankLine = (): Line => ({ key: nextKey++, product: null, qty: 1, unitPrice: 0, discountAmount: 0, discountPercent: null, note: "" });

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

/** The lines of a saved invoice, ready to correct. */
const linesOf = (invoice: InvoiceDetail): Line[] =>
  invoice.lines.map((l) => ({
    key: nextKey++,
    product: { id: l.productId, name: l.productName, variant: l.variant, unit: l.unit },
    qty: l.qty,
    unitPrice: l.unitPrice,
    discountAmount: l.discountAmount,
    discountPercent: null,
    note: l.note,
  }));

/** "2,5" → 250 basis points. */
const parsePercent = (text: string) => Math.round(Number(text.replace(",", ".")) * 100) || 0;

/** The line discount in rupiah, which is all the server stores; a percent follows qty and price. */
const lineDiscount = (l: Line) =>
  l.discountPercent === null ? l.discountAmount : applyBasisPoints(rupiah(l.qty * l.unitPrice), parsePercent(l.discountPercent));

function tryTotals(lines: Line[], kind: DiscountKind, value: number): { totals: Totals | null; error: string | null } {
  if (lines.length === 0) return { totals: null, error: null };
  try {
    return { totals: computeTotals(lines.map((l) => ({ qty: l.qty, unitPrice: rupiah(l.unitPrice), discountAmount: rupiah(lineDiscount(l)) })), { kind, value }), error: null };
  } catch (err) {
    if (err instanceof DomainError) return { totals: null, error: err.message };
    throw err;
  }
}

/**
 * The invoice as a document: header (customer, date, terms), a keyboard-first line table and a
 * read-only totals panel. The server recomputes every number on save. With `edit` it opens on a
 * saved invoice and saves an Ubah: a corrected copy that replaces it, with a reason.
 */
export function InvoiceForm({
  onSaved,
  kind = "invoice",
  edit,
}: {
  onSaved: (id: string) => void;
  kind?: "invoice" | "quote";
  edit?: InvoiceDetail;
}) {
  const quote = kind === "quote";
  const queryClient = useQueryClient();
  const [customer, setCustomer] = useState<Contact | null>(
    edit ? { id: edit.customer.id, code: edit.customer.code, name: edit.customer.name, paymentTermsDays: edit.termsDays } : null,
  );
  const [date, setDate] = useState(edit?.date ?? businessDate());
  const [termsDays, setTermsDays] = useState(edit?.termsDays ?? 0);
  /** Ubah sets the due date itself, like the old app; the terms follow from it. */
  const [dueDate, setDueDate] = useState(edit?.dueDate ?? "");
  const [validUntil, setValidUntil] = useState(() => addDays(businessDate(), QUOTATION_VALID_DAYS));
  const [lines, setLines] = useState<Line[]>(() => (edit ? linesOf(edit) : [blankLine()]));
  const [showLineDiscount, setShowLineDiscount] = useState(() => edit?.lines.some((l) => l.discountAmount > 0) ?? false);
  const [discountKind, setDiscountKind] = useState<DiscountKind>(edit?.discountKind ?? "none");
  const [discountText, setDiscountText] = useState(edit?.discountKind === "percent" ? percentFormat.format(edit.discountValue / 100) : "");
  const [discountAmount, setDiscountAmount] = useState(edit?.discountKind === "amount" ? edit.discountValue : 0);
  const [note, setNote] = useState(edit?.note ?? "");
  const [reason, setReason] = useState("");
  const [payment, setPayment] = useState<PaymentValues | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  /** Refused until an admin approves: a discount over the cap, or an Ubah that lowers the total. */
  const [blocked, setBlocked] = useState<{ request: ApprovalRequestInput; retry: (approval: ApprovalInput) => Promise<void>; message: string } | null>(
    null,
  );

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
    const base = {
      customerId: customer?.id ?? "",
      date,
      discountKind,
      discountValue,
      note,
      lines: filled.map((l) => ({
        productId: l.product!.id,
        qty: l.qty,
        unitPrice: l.unitPrice,
        discountAmount: lineDiscount(l),
        note: l.note,
      })),
    };
    const invoice = salesInvoiceInput.safeParse({ ...base, termsDays, payment });
    const quotation = quotationInput.safeParse({ ...base, validUntil });
    const change = salesInvoiceEditInput.safeParse({ ...base, termsDays: date && dueDate ? daysBetween(date, dueDate) : 0, reason });
    const parsed = quote ? quotation : edit ? change : invoice;
    if (!parsed.success) {
      const errs = fieldErrors(parsed.error);
      if (edit && errs.termsDays) errs.termsDays = dueDate < date ? "Jatuh tempo tidak boleh sebelum tanggal faktur" : "Jatuh tempo maksimal 365 hari";
      setErrors(errs);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      if (quotation.success && quote) await saveQuote(quotation.data);
      else if (edit && change.success) await saveEdit(edit, change.data);
      else if (invoice.success) await save(invoice.data);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      if (err.approval && edit && change.success) {
        setBlocked({
          request: { action: "sales.invoice.edit", originalId: edit.id, edit: change.data },
          retry: (approval) => saveEdit(edit, { ...change.data, approval }),
          message: err.message,
        });
      } else if (err.approval && invoice.success) {
        setBlocked({
          request: { action: "sales.invoice", invoice: invoice.data },
          retry: (approval) => save({ ...invoice.data, approval }),
          message: err.message,
        });
      } else {
        setErrors(err.fields);
        toast(err.message, "down");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function save(invoice: SalesInvoiceInput) {
    const saved = await unwrap(api.sales.$post({ json: invoice }));
    await queryClient.invalidateQueries({ queryKey: ["sales"] });
    await queryClient.invalidateQueries({ queryKey: ["insights"] });
    await queryClient.invalidateQueries({ queryKey: ["products"] });
    toast(`${saved.number} disimpan`, "up");
    onSaved(saved.id);
  }

  async function saveEdit(original: InvoiceDetail, input: SalesInvoiceEditInput) {
    const saved = await unwrap(api.sales[":id"].edit.$post({ param: { id: original.id }, json: input }));
    await queryClient.invalidateQueries({ queryKey: ["sales"] });
    await queryClient.invalidateQueries({ queryKey: ["insights"] });
    await queryClient.invalidateQueries({ queryKey: ["products"] });
    await queryClient.invalidateQueries({ queryKey: ["invoice-bundles"] });
    toast(`${original.number} diubah menjadi ${saved.number}`, "up");
    onSaved(saved.id);
  }

  async function saveQuote(input: QuotationInput) {
    const saved = await unwrap(api.quotations.$post({ json: input }));
    await queryClient.invalidateQueries({ queryKey: ["quotations"] });
    toast(`${saved.number} disimpan`, "up");
    onSaved(saved.id);
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
                if (c) {
                  setTermsDays(c.paymentTermsDays);
                  if (date) setDueDate(addDays(date, c.paymentTermsDays));
                }
              }}
            />
          )}
        </Field>
        <Field label="Tanggal" error={errors.date}>
          {(p) => (
            <DateInput
              {...p}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                if (e.target.value) setValidUntil(addDays(e.target.value, QUOTATION_VALID_DAYS));
              }}
            />
          )}
        </Field>
        {quote ? (
          <Field label="Berlaku sampai" error={errors.validUntil}>
            {(p) => <DateInput {...p} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />}
          </Field>
        ) : edit ? (
          <Field label="Jatuh tempo" error={errors.termsDays}>
            {(p) => <DateInput {...p} value={dueDate} min={date} onChange={(e) => setDueDate(e.target.value)} />}
          </Field>
        ) : (
          <>
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
          </>
        )}
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
                {showLineDiscount && <th className="w-48 px-2 py-2 text-right font-normal">Diskon</th>}
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
          <Field label={quote ? "Catatan penawaran" : "Catatan faktur"} error={errors.note}>
            {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          {edit && (
            <Field label="Alasan perubahan" error={errors.reason}>
              {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
          )}
          {!quote && !edit && (
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
          )}
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
          paid={edit?.paid}
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
          {quote ? "Simpan penawaran" : edit ? "Simpan perubahan" : "Simpan faktur"}
        </Button>
      </div>
      {blocked && <ApprovalDialog message={blocked.message} request={blocked.request} submit={blocked.retry} onClose={() => setBlocked(null)} />}
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
              {line.product.stock !== undefined && (
                <span className={cx("text-xs", line.product.stock < line.qty ? "text-warn" : "text-faint")}>
                  stok {line.product.stock} {line.product.unit}
                </span>
              )}
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
          <div className="flex gap-1">
            <Select
              className="h-8 w-14 shrink-0 px-1.5"
              aria-label={`Jenis diskon baris ${index + 1}`}
              value={line.discountPercent === null ? "amount" : "percent"}
              onChange={(e) => onChange(e.target.value === "percent" ? { discountPercent: "" } : { discountPercent: null, discountAmount: 0 })}
            >
              <option value="amount">Rp</option>
              <option value="percent">%</option>
            </Select>
            {line.discountPercent === null ? (
              <MoneyInput
                aria-label={`Diskon baris ${index + 1}`}
                className="flex-1 [&_input]:h-8"
                value={line.discountAmount}
                onChange={(discountAmount) => onChange({ discountAmount })}
                onKeyDown={enterTo(onNext)}
              />
            ) : (
              <div className="relative flex-1">
                <input
                  aria-label={`Diskon persen baris ${index + 1}`}
                  inputMode="decimal"
                  className={cx(cellInput, "pr-6")}
                  placeholder="0"
                  value={line.discountPercent}
                  onChange={(e) => onChange({ discountPercent: e.target.value.replace(/[^\d,]/g, "") })}
                  onKeyDown={enterTo(onNext)}
                />
                <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-faint">%</span>
              </div>
            )}
          </div>
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
  paid,
  error,
  discountKind,
  discountInput,
}: {
  totals: Totals | null;
  /** Ubah: payments already on the faktur, which move to the corrected one. */
  paid: number | undefined;
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
      {paid !== undefined && (
        <>
          <Row label="Terbayar" value={money(paid)} />
          {totals && totals.total < paid ? (
            <Row label="Lebih bayar" value={money(paid - totals.total)} />
          ) : (
            <Row label="Sisa tagihan" value={totals ? money(totals.total - paid) : "—"} />
          )}
        </>
      )}
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
