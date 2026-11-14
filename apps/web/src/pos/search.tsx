import { rankProducts, stockLevel } from "@billy/core";
import { Search } from "lucide-react";
import type { KeyboardEvent, Ref } from "react";
import { cx } from "../lib/cx.ts";
import type { CatalogProduct } from "./local.ts";
import { money } from "./ui.tsx";

const MAX_RESULTS = 8;

/** The best matches for the search field; the ranking is shared with the back-office product search. */
export const searchProducts = (products: CatalogProduct[], query: string): CatalogProduct[] =>
  rankProducts(products, query).slice(0, MAX_RESULTS);

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
}: {
  inputRef: Ref<HTMLInputElement>;
  query: string;
  results: CatalogProduct[];
  highlight: number;
  onQuery: (q: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onPick: (product: CatalogProduct) => void;
  onBlur: () => void;
}) {
  return (
    <div className="relative border-b border-line px-4 py-3.5">
      <label className="flex items-center gap-2.5 rounded-[10px] border-[1.5px] border-ink px-3 py-2.5 text-[15px]">
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
      {query.trim() && (
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
