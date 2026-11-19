import { rupiah, type Rupiah } from "@billy/core";
import { X } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { Badge } from "../components/ui/badge.tsx";
import { toast } from "../components/ui/toast.tsx";
import { cx } from "../lib/cx.ts";
import { type Cart, type CartAction, type CartLine, priceChanged } from "./cart.ts";
import { productLabel } from "./search.tsx";
import { money } from "./ui.tsx";

/** The editable cells of a row, left to right; ↑/↓ move between rows within one column. */
export type CartColumn = "note" | "price" | "qty" | "discount";

/** Focuses a cell of the cart, e.g. qty after Shift+Enter or price after H. */
export const focusCell = (row: number, column: CartColumn) =>
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-cell="${row}:${column}"]`)?.focus());

/** Checks a typed value against the line and returns the action that applies it, or why it cannot. */
const columns: Record<Exclude<CartColumn, "note">, (line: CartLine, index: number, value: number) => CartAction | string> = {
  price: (line, index, value) =>
    value <= 0
      ? "Isi harga lebih dari 0"
      : line.discountAmount > line.qty * value
        ? `Diskon baris ${money(line.discountAmount)} melebihi harga`
        : { type: "price", index, unitPrice: rupiah(value) },
  qty: (line, index, value) =>
    value < 1
      ? "Isi qty minimal 1"
      : line.discountAmount > value * line.unitPrice
        ? `Diskon baris ${money(line.discountAmount)} melebihi harga`
        : { type: "qty", index, qty: value },
  discount: (line, index, value) =>
    value > line.qty * line.unitPrice ? `Diskon maksimal ${money(line.qty * line.unitPrice)}` : { type: "discount", index, amount: rupiah(value) },
};

/**
 * The cart as a spreadsheet: price, qty, discount and the colour code are typed straight into their cells.
 * Enter keeps the value and returns to the search box, Esc drops it, Tab and ↑/↓ move between cells.
 */
export function CartTable({
  cart,
  lineTotals,
  dispatch,
  onCancel,
  onDone,
}: {
  cart: Cart;
  lineTotals: Rupiah[];
  dispatch: (action: CartAction) => void;
  onCancel: () => void;
  /** Hands focus back to the product search. */
  onDone: () => void;
}) {
  const items = cart.lines.reduce((sum, l) => sum + l.qty, 0);
  const th = "px-2 py-2.5 text-xs font-normal text-muted";
  const cellProps = (i: number, column: Exclude<CartColumn, "note">) => {
    const line = cart.lines[i]!;
    return {
      id: `${i}:${column}`,
      value: column === "price" ? line.unitPrice : column === "qty" ? line.qty : line.discountAmount,
      format: column === "qty" ? String : money,
      onFocus: () => dispatch({ type: "select", index: i }),
      onCommit: (value: number) => {
        const result = columns[column](line, i, value);
        if (typeof result === "string") return result;
        dispatch(result);
        return null;
      },
      onMove: (step: number) => focusCell(Math.max(0, Math.min(i + step, cart.lines.length - 1)), column),
      onDone,
    };
  };
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-[1] bg-panel">
            <tr className="border-b border-line text-left">
              <th className={cx(th, "w-7 pl-4")}>#</th>
              <th className={th}>Produk</th>
              <th className={cx(th, "w-32 text-right")}>Harga</th>
              <th className={cx(th, "w-20 text-right")}>Qty</th>
              <th className={cx(th, "w-28 text-right")}>Diskon</th>
              <th className={cx(th, "w-32 text-right")}>Jumlah</th>
              <th className={cx(th, "w-9 pr-3")}>
                <span className="sr-only">Hapus</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {cart.lines.map((line, i) => {
              const selected = i === cart.selected;
              return (
                <tr
                  key={`${line.productId}-${i}`}
                  aria-selected={selected}
                  onClick={() => dispatch({ type: "select", index: i })}
                  className={cx("group border-b border-line-2 align-top", selected && "bg-line-2")}
                >
                  <td className="py-3 pr-2 pl-4 tabular-nums">{i + 1}</td>
                  <td className="px-2 py-3">
                    {productLabel(line)}
                    <small className="block text-xs text-muted">
                      {[line.unit.toUpperCase(), line.categoryName].filter(Boolean).join(" · ")}
                    </small>
                    {(selected || line.note) && (
                      <NoteCell
                        id={`${i}:note`}
                        value={line.note}
                        onFocus={() => dispatch({ type: "select", index: i })}
                        onCommit={(note) => dispatch({ type: "note", index: i, note })}
                        onMove={(step) => focusCell(Math.max(0, Math.min(i + step, cart.lines.length - 1)), "note")}
                        onDone={onDone}
                      />
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <NumberCell label={`Harga baris ${i + 1}`} {...cellProps(i, "price")} />
                    {priceChanged(line) && (
                      <span className="mt-1 flex flex-col items-end gap-1">
                        <Badge tone="warn">Harga mesin</Badge>
                        <s className="text-xs text-faint" aria-label="Harga katalog">
                          {money(line.listPrice!)}
                        </s>
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <NumberCell label={`Qty baris ${i + 1}`} {...cellProps(i, "qty")} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <NumberCell label={`Diskon baris ${i + 1}`} muted={!line.discountAmount} {...cellProps(i, "discount")} />
                  </td>
                  <td className="px-2 py-3 text-right font-medium tabular-nums">{lineTotals[i] !== undefined ? money(lineTotals[i]) : "—"}</td>
                  <td className="py-2.5 pr-3 text-right">
                    <button
                      type="button"
                      aria-label={`Hapus baris ${i + 1}`}
                      title="Hapus baris (Del)"
                      onClick={(e) => {
                        e.stopPropagation();
                        dispatch({ type: "remove", index: i });
                        onDone();
                      }}
                      className="rounded-md p-1 text-faint opacity-0 group-hover:opacity-100 group-aria-selected:opacity-100 hover:bg-down/10 hover:text-down focus-visible:opacity-100"
                    >
                      <X className="size-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {cart.lines.length === 0 && (
          <div className="flex flex-col items-center gap-1 px-6 py-16 text-center text-muted">
            <p className="font-medium text-ink-2">Keranjang kosong</p>
            <p>Ketik nama produk atau scan barcode, lalu tekan Enter.</p>
          </div>
        )}
      </div>
      <div className="flex items-center gap-4 border-t border-line px-4 py-2.5 text-xs text-muted">
        <span>
          {cart.lines.length} produk · {items} item
        </span>
        {cart.lines.length > 0 && <span className="max-md:hidden">Klik angka untuk ubah · Enter simpan · Esc batal · Tab pindah kolom</span>}
        <span className="flex-1" />
        {cart.lines.length > 0 && (
          <button type="button" onClick={onCancel} className="text-down hover:underline">
            Batalkan transaksi
          </button>
        )}
      </div>
    </>
  );
}

const cellInput =
  "h-8 w-full rounded-[7px] border border-line-2 bg-bg/40 px-2 text-right tabular-nums outline-none hover:border-line focus:border-ink focus:bg-panel aria-invalid:border-down";

/** Shared key handling: Enter keeps and returns to search, Esc reverts, ↑/↓ keep and change row. */
function cellKeys(commit: () => boolean, revert: () => void, onMove: (step: number) => void, onDone: () => void) {
  return (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (commit()) onDone();
    } else if (e.key === "Escape") {
      e.preventDefault();
      revert();
      onDone();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      if (commit()) onMove(e.key === "ArrowDown" ? 1 : -1);
    }
  };
}

function NumberCell({
  id,
  label,
  value,
  format,
  muted,
  onFocus,
  onCommit,
  onMove,
  onDone,
}: {
  id: string;
  label: string;
  value: number;
  format: (n: number) => string;
  muted?: boolean;
  onFocus: () => void;
  /** Applies the value, or returns why it cannot. */
  onCommit: (value: number) => string | null;
  onMove: (step: number) => void;
  onDone: () => void;
}) {
  /** The text being typed; null when the cell shows the line's value. */
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reverted = useRef(false);
  const commit = () => {
    if (draft === null) return true;
    const typed = Number(draft.replace(/\D/g, "") || 0);
    const problem = typed === value ? null : onCommit(typed);
    setError(problem);
    if (problem) {
      toast(problem, "down");
      return false;
    }
    setDraft(null);
    return true;
  };
  const revert = () => {
    reverted.current = true;
    setDraft(null);
    setError(null);
  };
  return (
    <input
      data-cell={id}
      aria-label={label}
      aria-invalid={error !== null}
      title={error ?? undefined}
      inputMode="numeric"
      autoComplete="off"
      value={draft ?? format(value)}
      onFocus={(e) => {
        reverted.current = false;
        setDraft(format(value));
        onFocus();
        e.target.select();
      }}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, 15);
        setDraft(digits ? format(Number(digits)) : "");
      }}
      onKeyDown={cellKeys(commit, revert, onMove, onDone)}
      onBlur={() => {
        // Leaving a cell keeps a valid value; an invalid one is dropped rather than left half-typed.
        if (!reverted.current && !commit()) revert();
        setDraft(null);
      }}
      onClick={(e) => e.stopPropagation()}
      className={cx(cellInput, muted && "text-faint focus:text-ink")}
    />
  );
}

function NoteCell({
  id,
  value,
  onFocus,
  onCommit,
  onMove,
  onDone,
}: {
  id: string;
  value: string;
  onFocus: () => void;
  onCommit: (note: string) => void;
  onMove: (step: number) => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const reverted = useRef(false);
  const commit = () => {
    if (draft !== null && draft.trim() !== value) onCommit(draft);
    setDraft(null);
    return true;
  };
  return (
    <label className="mt-1 flex items-center gap-1.5 text-xs text-muted">
      <input
        data-cell={id}
        aria-label="Kode warna tinting"
        placeholder="+ Kode warna tinting"
        maxLength={200}
        autoComplete="off"
        spellCheck={false}
        value={draft ?? value}
        onFocus={() => {
          reverted.current = false;
          setDraft(value);
          onFocus();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={cellKeys(
          commit,
          () => {
            reverted.current = true;
            setDraft(null);
          },
          onMove,
          onDone,
        )}
        onBlur={() => !reverted.current && commit()}
        onClick={(e) => e.stopPropagation()}
        className={cx(
          "h-6 w-56 max-w-full rounded-md border border-dashed bg-transparent px-1.5 text-ink-2 outline-none placeholder:text-faint focus:border-solid focus:border-ink focus:bg-panel",
          value ? "border-line" : "border-transparent hover:border-line",
        )}
      />
      {value && <span className="whitespace-nowrap">tidak bisa retur</span>}
    </label>
  );
}
