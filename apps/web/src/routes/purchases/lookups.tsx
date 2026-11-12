import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { type ReactNode, useEffect, useState } from "react";
import { Combobox } from "../../components/ui/combobox.tsx";
import { api, unwrap } from "../../lib/api.ts";

export type Supplier = InferResponseType<typeof api.purchases.suppliers.$get, 200>[number];
export type Account = InferResponseType<typeof api.purchases.accounts.$get, 200>[number];
export type Product = InferResponseType<typeof api.products.$get, 200>["rows"][number];

const qty = new Intl.NumberFormat("id-ID");

/** The searchable record types: each searches on the server, so a 4.000-product catalog stays fast. */
export const lookups = {
  supplier: {
    search: (q: string) => unwrap(api.purchases.suppliers.$get({ query: { q } })),
    label: (s: Supplier) => s.name,
    hint: (s: Supplier) => s.code,
  },
  account: {
    search: (q: string) => unwrap(api.purchases.accounts.$get({ query: { q } })),
    label: (a: Account) => a.name,
    hint: (a: Account) => a.code,
  },
  product: {
    search: async (q: string) => (await unwrap(api.products.$get({ query: { q, pageSize: "20" } }))).rows,
    label: (p: Product) => [p.name, p.variant].filter(Boolean).join(" "),
    hint: (p: Product) => `${qty.format(p.stock)} ${p.unit}`,
  },
};

type Lookup<Row extends { id: string }> = { search: (q: string) => Promise<Row[]>; label: (row: Row) => string; hint: (row: Row) => ReactNode };

/** Search text plus the matching rows, fetched 200 ms after typing stops. */
export function useLookup<Row extends { id: string }>(kind: keyof typeof lookups, lookup: Lookup<Row>) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  const result = useQuery({
    queryKey: ["lookup", kind, debounced],
    queryFn: () => lookup.search(debounced),
    placeholderData: keepPreviousData,
  });
  // While the next search is in flight, the previous rows stay visible but only those that match
  // what is typed now, so a fast Enter can never pick a row from the old search.
  const fresh = !result.isPlaceholderData && debounced === query.trim();
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = (result.data ?? []).filter(
    (row) => fresh || terms.every((term) => lookup.label(row).toLowerCase().includes(term)),
  );
  return {
    query,
    setQuery,
    rows,
    options: rows.map((row) => ({ value: row.id, label: lookup.label(row), hint: lookup.hint(row) })),
  };
}

/**
 * A Combobox bound to one record. Typing searches without dropping the current choice; leaving
 * the field shows the chosen label again, and clearing the text clears the choice.
 */
export function LookupPicker<Row extends { id: string }>({
  kind,
  lookup,
  value,
  onChange,
  ...input
}: {
  kind: keyof typeof lookups;
  lookup: Lookup<Row>;
  value: Row | null;
  onChange: (row: Row | null) => void;
  id?: string;
  placeholder?: string;
  "aria-invalid"?: true;
}) {
  const { query, setQuery, rows, options } = useLookup(kind, lookup);
  const selectedLabel = value ? lookup.label(value) : "";
  useEffect(() => setQuery(selectedLabel), [selectedLabel, setQuery]);
  return (
    <div onBlur={() => setQuery(selectedLabel)}>
      <Combobox
        {...input}
        options={options}
        query={query}
        onQueryChange={(text) => {
          setQuery(text);
          if (!text.trim() && value) onChange(null);
        }}
        onSelect={(option) => onChange(rows.find((row) => row.id === option.value) ?? null)}
      />
    </div>
  );
}
