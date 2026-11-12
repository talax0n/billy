import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Combobox } from "../../components/ui/combobox.tsx";
import { api, unwrap } from "../../lib/api.ts";
import type { Customer } from "./queries.ts";

/** Type-to-search over active customers. Shows the picked name until the user types again. */
export function CustomerPicker({
  id,
  value,
  onChange,
  placeholder = "Cari pelanggan…",
  "aria-invalid": invalid,
}: {
  id?: string;
  value: Pick<Customer, "id" | "name"> | null;
  onChange: (customer: Customer) => void;
  placeholder?: string;
  "aria-invalid"?: true;
}) {
  const [query, setQuery] = useState(value?.name ?? "");
  const customers = useQuery({
    queryKey: ["sales", "customers", query],
    queryFn: () => unwrap(api.sales.customers.$get({ query: { q: query === value?.name ? "" : query } })),
  });
  return (
    <Combobox
      {...(id && { id })}
      {...(invalid && { "aria-invalid": invalid })}
      query={query}
      onQueryChange={setQuery}
      placeholder={placeholder}
      options={(customers.data ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.code }))}
      onSelect={(option) => {
        const customer = customers.data?.find((c) => c.id === option.value);
        if (!customer) return;
        setQuery(customer.name);
        onChange(customer);
      }}
    />
  );
}
