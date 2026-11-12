import { rupiah, type Rupiah } from "@billy/core";
import { Search } from "lucide-react";
import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useId } from "react";
import { cx } from "../../lib/cx.ts";

export const controlClass = cx(
  "h-9 w-full rounded-lg border border-line bg-panel px-3 text-ink placeholder:text-faint",
  "focus:border-ink-2 focus:outline-none disabled:opacity-60 aria-invalid:border-down",
);

/** Label, control and message. The control is rendered by `children(id)` so the label targets it. */
export function Field({
  label,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  className?: string;
  children: (props: { id: string; "aria-invalid"?: true }) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-ink-2">
        {label}
      </label>
      {children({ id, ...(error && { "aria-invalid": true as const }) })}
      {error ? <p className="text-xs text-down">{error}</p> : hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(controlClass, className)} {...props} />;
}

/** Business date picker; value is `YYYY-MM-DD`. */
export function DateInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <Input type="date" {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(controlClass, "appearance-auto pr-2", className)} {...props}>
      {children}
    </select>
  );
}

export function SearchInput({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <div className={cx("relative w-full max-w-xs", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
      <input type="search" className={cx(controlClass, "pl-8")} placeholder="Cari…" {...props} />
    </div>
  );
}

const idr = new Intl.NumberFormat("id-ID");

/** Whole-rupiah input shown as `1.250.000` while typing. Empty input yields 0. */
export function MoneyInput({
  value,
  onChange,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number;
  onChange: (value: Rupiah) => void;
}) {
  return (
    <div className={cx("relative", className)}>
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint">Rp</span>
      <input
        inputMode="numeric"
        className={cx(controlClass, "pl-9 text-right tabular-nums")}
        value={value ? idr.format(value) : ""}
        placeholder="0"
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 15);
          onChange(rupiah(Number(digits || 0)));
        }}
        {...props}
      />
    </div>
  );
}
