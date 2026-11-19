import { rankProducts, stockLevel } from "@billy/core";
import { Search } from "lucide-react";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import { cx } from "../lib/cx.ts";
import type { CatalogProduct } from "./local.ts";
import { money } from "./ui.tsx";

const MAX_RESULTS = 8;

/** The best matches for the search field; the ranking is shared with the back-office product search. */
export const searchProducts = (products: CatalogProduct[], query: string): CatalogProduct[] =>
  rankProducts(products, query).slice(0, MAX_RESULTS);

// ponytail: plain list capped at 300 rows; virtualize if a shop's catalog makes scrolling slow.
const MAX_BROWSE = 300;

/** The Produk view: every product when the search is empty, else every match, best first. */
export const browseProducts = (products: CatalogProduct[], query: string): CatalogProduct[] =>
  (query.trim() ? rankProducts(products, query) : products).slice(0, MAX_BROWSE);

/** A scanner types the barcode and Enter: an exact barcode or code match wins over the highlighted row. */
export function exactMatch(products: CatalogProduct[], query: string): CatalogProduct | undefined {
  const q = query.trim().toLowerCase();
  return q ? products.find((p) => p.barcode?.toLowerCase() === q || p.code?.toLowerCase() === q) : undefined;
}

export const productLabel = (p: { name: string; variant: string }) => `${p.name} ${p.variant}`.trim();

/** The always-focused search field that doubles as barcode input, with its results dropdown. */
export function SearchBox({
  inputRef,
  query,
  results,
  highlight,
  onQuery,
  onKeyDown,
  onPick,
  onBlur,
  dropdown = true,
  view,
}: {
  inputRef: Ref<HTMLInputElement>;
  query: string;
  results: CatalogProduct[];
  highlight: number;
  onQuery: (q: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onPick: (product: CatalogProduct) => void;
  onBlur: () => void;
  /** Off in the Produk view, where the list below already shows the matches. */
  dropdown?: boolean;
  /** The Nota / Produk switch, beside the field. */
  view?: ReactNode;
}) {
  return (
    <div className="relative flex items-center gap-2.5 border-b border-line px-4 py-3.5">
      {view}
      <label className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border-[1.5px] border-ink px-3 py-2.5 text-[15px]">
        <Search className="size-4 text-muted" />
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          aria-label="Cari produk atau scan barcode"
          placeholder="Cari produk atau scan barcode"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint"
        />
      </label>
      {dropdown && query.trim() && (
        <div className="absolute inset-x-4 top-[62px] z-10 overflow-hidden rounded-[10px] border border-line bg-panel shadow-[0_12px_32px_rgb(0_0_0/0.12)]">
          {results.length === 0 ? (
            <p className="px-3 py-3 text-muted">Tidak ada produk untuk “{query.trim()}”</p>
          ) : (
            <ul role="listbox" aria-label="Hasil pencarian">
              {results.map((p, i) => {
                const low = stockLevel(p.stock, p.minStock) !== "ok";
                return (
                  <li
                    key={p.id}
                    role="option"
                    aria-selected={i === highlight}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onPick(p);
                    }}
                    className={cx(
                      "grid cursor-pointer grid-cols-[1fr_80px_110px] items-center gap-2.5 px-3 py-2",
                      i === highlight && "bg-line-2",
                    )}
                  >
                    <div>
                      {productLabel(p)}
                      <small className="block text-xs text-muted">
                        {[p.unit.toUpperCase(), p.categoryName, p.code].filter(Boolean).join(" · ")}
                      </small>
                    </div>
                    <div className={cx("text-right tabular-nums", low && "text-warn")}>stok {p.stock}</div>
                    <div className={cx("text-right tabular-nums", i === highlight && "font-semibold")}>{money(p.sellPrice)}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** The Produk view: the catalog as a table, filtered by the search box. Click or Enter adds to the nota. */
export function ProductList({
  products,
  highlight,
  inCart,
  onPick,
}: {
  products: CatalogProduct[];
  highlight: number;
  /** Qty of each product already on the nota. */
  inCart: Map<string, number>;
  onPick: (product: CatalogProduct) => void;
}) {
  const th = "px-2 py-2.5 text-xs font-normal text-muted";
  if (products.length === 0) return <p className="px-6 py-16 text-center text-muted">Tidak ada produk yang cocok.</p>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-[1] bg-panel">
          <tr className="border-b border-line text-left">
            <th className={cx(th, "pl-4")}>Produk</th>
            <th className={cx(th, "w-32")}>Kode</th>
            <th className={cx(th, "w-24 text-right")}>Stok</th>
            <th className={cx(th, "w-32 text-right")}>Harga</th>
            <th className={cx(th, "w-24 pr-4 text-right")}>Di nota</th>
          </tr>
        </thead>
        <tbody aria-label="Daftar produk">
          {products.map((p, i) => {
            const low = stockLevel(p.stock, p.minStock) !== "ok";
            const qty = inCart.get(p.id);
            return (
              <tr
                key={p.id}
                aria-selected={i === highlight}
                ref={i === highlight ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(p);
                }}
                className={cx("cursor-pointer border-b border-line-2 hover:bg-line-2", i === highlight && "bg-line-2")}
              >
                <td className="py-2.5 pr-2 pl-4">
                  {productLabel(p)}
                  <small className="block text-xs text-muted">{[p.unit.toUpperCase(), p.categoryName].filter(Boolean).join(" · ")}</small>
                </td>
                <td className="px-2 py-2.5 text-xs text-muted">{p.code ?? p.barcode ?? "—"}</td>
                <td className={cx("px-2 py-2.5 text-right tabular-nums", low && "text-warn")}>{p.stock}</td>
                <td className="px-2 py-2.5 text-right font-medium tabular-nums">{money(p.sellPrice)}</td>
                <td className="py-2.5 pr-4 pl-2 text-right tabular-nums">{qty ? <b className="font-medium">{qty}</b> : <span className="text-faint">+</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
