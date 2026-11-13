import { accountKindLabels } from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { Select } from "../../components/ui/field.tsx";
import { api, unwrap } from "../../lib/api.ts";

export const accountLookupQuery = {
  queryKey: ["accounts", "lookup"],
  queryFn: () => unwrap(api.accounts.lookup.$get()),
};

/** Picker over the active accounts, grouped by kind. */
export function AccountSelect({
  value,
  onChange,
  placeholder = "Pilih akun",
  ...props
}: {
  id: string;
  "aria-invalid"?: true;
  "aria-label"?: string;
  value: string;
  onChange: (accountId: string) => void;
  placeholder?: string;
}) {
  const accounts = useQuery(accountLookupQuery);
  const kinds = Object.keys(accountKindLabels) as (keyof typeof accountKindLabels)[];
  return (
    <Select {...props} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {kinds.map((kind) => (
        <optgroup key={kind} label={accountKindLabels[kind]}>
          {accounts.data
            ?.filter((account) => account.kind === kind)
            .map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
  );
}
