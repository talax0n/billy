import { formatRupiah, type Rupiah } from "@billy/core";
import { cx } from "../../lib/cx.ts";

/** Two to four mutually exclusive choices, e.g. the payment method. */
export function Segmented<Value extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Record<Value, string>;
  value: Value;
  onChange: (value: Value) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-line-2 p-0.5">
      {(Object.entries(options) as [Value, string][]).map(([option, text]) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cx("h-8 rounded-md px-3 text-muted", value === option && "bg-panel font-medium text-ink")}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export interface TotalsRow {
  label: string;
  value: Rupiah | null;
  /** A grand total: bigger, with a rule above it. */
  strong?: boolean;
  tone?: "down" | "up" | undefined;
}

/** Read-only computed figures, so computed values never look editable. */
export function TotalsPanel({ rows, className }: { rows: TotalsRow[]; className?: string }) {
  return (
    <dl className={cx("flex flex-col gap-1.5 rounded-xl border border-line px-4 py-3", className)}>
      {rows.map((row) => (
        <div
          key={row.label}
          className={cx("flex items-baseline justify-between gap-4", row.strong && "mt-1 border-t border-line pt-2.5 text-base font-semibold")}
        >
          <dt className={row.strong ? undefined : "text-ink-2"}>{row.label}</dt>
          <dd className={cx("tabular-nums", row.tone === "down" && "text-down", row.tone === "up" && "text-up")}>
            {row.value === null ? "—" : formatRupiah(row.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** 1100 basis points → "11%". */
export const formatPercent = (bp: number) => `${(bp / 100).toLocaleString("id-ID")}%`;

export const paymentMethodLabels = { cash: "Tunai", transfer: "Transfer", qris: "QRIS", giro: "Giro" } as const;
