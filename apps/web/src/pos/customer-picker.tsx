import { type Ref, useState } from "react";
import { cx } from "../lib/cx.ts";
import type { CatalogCustomer } from "./local.ts";

/**
 * The customer chip in the top bar, typed into directly (F3). Focus shows the matches,
 * Enter picks the highlighted one, Esc keeps the current customer. The first option is always "Umum".
 */
export function CustomerPicker({
  inputRef,
  customers,
  customer,
  onPick,
  onDone,
}: {
  inputRef: Ref<HTMLInputElement>;
  customers: CatalogCustomer[];
  customer: CatalogCustomer | null;
  onPick: (customer: CatalogCustomer | null) => void;
  /** Hands focus back to the product search. */
  onDone: () => void;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const terms = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const matches = customers.filter((c) => terms.every((t) => `${c.name} ${c.code}`.toLowerCase().includes(t))).slice(0, 8);
  const options: (CatalogCustomer | null)[] = [null, ...matches];
  const pick = (c: CatalogCustomer | null) => {
    onPick(c);
    setQuery(null);
    onDone();
  };
  return (
    <div className="relative">
      <label className="flex items-center gap-1.5 rounded-full border border-line bg-panel py-1 pl-3 pr-1 whitespace-nowrap text-muted focus-within:border-ink">
        Pelanggan
        <input
          ref={inputRef}
          aria-label="Cari pelanggan"
          role="combobox"
          aria-expanded={query !== null}
          aria-controls="customer-options"
          autoComplete="off"
          spellCheck={false}
          placeholder={customer?.name ?? "Umum"}
          value={query ?? customer?.name ?? "Umum"}
          size={Math.max(8, (query ?? customer?.name ?? "Umum").length + 1)}
          onFocus={(e) => {
            setQuery("");
            setHighlight(0);
            e.target.select();
          }}
          onBlur={() => setQuery(null)}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(e.target.value.trim() ? 1 : 0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              const step = e.key === "ArrowDown" ? 1 : -1;
              setHighlight((h) => (h + step + options.length) % options.length);
            } else if (e.key === "Enter") pick(options[highlight] ?? null);
            else if (e.key === "Escape") {
              setQuery(null);
              onDone();
            } else return;
            e.preventDefault();
            e.stopPropagation();
          }}
          className="min-w-0 rounded-full bg-transparent px-1 font-medium text-ink outline-none placeholder:text-faint"
        />
      </label>
      {query !== null && (
        <ul
          id="customer-options"
          role="listbox"
          aria-label="Pelanggan"
          className="absolute top-full left-0 z-20 mt-1 w-80 overflow-hidden rounded-[10px] border border-line bg-panel p-1 shadow-[0_12px_32px_rgb(0_0_0/0.12)]"
        >
          {options.map((c, i) => (
            <li
              key={c?.id ?? "umum"}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={cx("flex cursor-pointer justify-between gap-3 rounded-lg px-3 py-2", i === highlight && "bg-line-2")}
            >
              <span>{c?.name ?? "Umum"}</span>
              <span className="text-muted">{c?.code ?? "tanpa nama"}</span>
            </li>
          ))}
          {terms.length > 0 && matches.length === 0 && <li className="px-3 py-2 text-muted">Tidak ada pelanggan yang cocok.</li>}
        </ul>
      )}
    </div>
  );
}
