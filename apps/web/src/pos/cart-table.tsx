import type { Rupiah } from "@billy/core";
import { useState } from "react";
import { cx } from "../lib/cx.ts";
import type { Cart, CartAction } from "./cart.ts";
import { productLabel } from "./search.tsx";
import { Kbd, money } from "./ui.tsx";

/** The cart: one row per line, the selected row tinted. `qtyEdit` opens an inline qty field on that row. */
export function CartTable({
  cart,
  lineTotals,
  dispatch,
  qtyEdit,
  onQtyEditDone,
}: {
  cart: Cart;
  lineTotals: Rupiah[];
  dispatch: (action: CartAction) => void;
  qtyEdit: number | null;
  onQtyEditDone: () => void;
}) {
  const items = cart.lines.reduce((sum, l) => sum + l.qty, 0);
  const th = "px-2 py-2.5 text-xs font-normal text-muted";
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-panel">
            <tr className="border-b border-line text-left">
              <th className={cx(th, "w-7 pl-4")}>#</th>
              <th className={th}>Produk</th>
              <th className={cx(th, "w-28 text-right")}>Harga</th>
              <th className={cx(th, "w-[120px] text-right")}>Qty</th>
              <th className={cx(th, "w-24 text-right")}>Diskon</th>
              <th className={cx(th, "w-32 pr-4 text-right")}>Jumlah</th>
            </tr>
          </thead>
          <tbody>
            {cart.lines.map((line, i) => (
              <tr
                key={`${line.productId}-${i}`}
                aria-selected={i === cart.selected}
                onClick={() => dispatch({ type: "select", index: i })}
                className={cx("border-b border-line-2 align-top", i === cart.selected && "bg-line-2")}
              >
                <td className="py-3 pr-2 pl-4">{i + 1}</td>
                <td className="px-2 py-3">
                  {productLabel(line)}
                  <small className="block text-xs text-muted">
                    {[line.unit.toUpperCase(), line.categoryName].filter(Boolean).join(" · ")}
                  </small>
                  {line.note && (
                    <span className="mt-1 inline-block rounded-md border border-dashed border-line px-1.5 text-xs text-ink-2">
                      {line.note} · tidak bisa retur
                    </span>
                  )}
                </td>
                <td className="px-2 py-3 text-right tabular-nums">{money(line.unitPrice)}</td>
                <td className="px-2 py-2.5 text-right">
                  {qtyEdit === i ? (
                    <QtyInput
                      initial={line.qty}
                      onDone={(qty) => {
                        if (qty) dispatch({ type: "qty", index: i, qty });
                        onQtyEditDone();
                      }}
                    />
                  ) : (
                    <span className="inline-flex items-center rounded-[7px] border border-line">
                      <button
                        type="button"
                        aria-label="Kurangi"
                        onClick={() => dispatch({ type: "qty", index: i, qty: line.qty - 1 })}
                        className="px-2 py-0.5 text-muted hover:text-ink"
                      >
                        −
                      </button>
                      <b className="min-w-8 border-x border-line px-2 py-0.5 text-center font-medium tabular-nums">{line.qty}</b>
                      <button
                        type="button"
                        aria-label="Tambah"
                        onClick={() => dispatch({ type: "qty", index: i, qty: line.qty + 1 })}
                        className="px-2 py-0.5 text-muted hover:text-ink"
                      >
                        +
                      </button>
                    </span>
                  )}
                </td>
                <td className={cx("px-2 py-3 text-right tabular-nums", !line.discountAmount && "text-faint")}>
                  {line.discountAmount ? `−${money(line.discountAmount)}` : 0}
                </td>
                <td className="py-3 pr-4 pl-2 text-right tabular-nums">{lineTotals[i] !== undefined ? money(lineTotals[i]) : "—"}</td>
              </tr>
            ))}
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
        <span className="flex-1" />
        <span className="flex items-center gap-1 max-md:hidden">
          Baris terpilih (↑↓): <Kbd>+</Kbd> <Kbd>−</Kbd> qty · <Kbd>D</Kbd> diskon · <Kbd>N</Kbd> catatan · <Kbd>Del</Kbd> hapus
        </span>
      </div>
    </>
  );
}

function QtyInput({ initial, onDone }: { initial: number; onDone: (qty: number | null) => void }) {
  const [value, setValue] = useState(String(initial));
  return (
    <input
      autoFocus
      inputMode="numeric"
      aria-label="Jumlah"
      value={value}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          onDone(Number(value) || null);
        }
        if (e.key === "Escape") onDone(null);
      }}
      onBlur={() => onDone(Number(value) || null)}
      className="h-7 w-16 rounded-[7px] border-[1.5px] border-ink bg-panel px-2 text-right tabular-nums outline-none"
    />
  );
}
