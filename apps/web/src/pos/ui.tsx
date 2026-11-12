import type { ReactNode } from "react";
import { cx } from "../lib/cx.ts";

const idr = new Intl.NumberFormat("id-ID");

/** `2432000` → `2.432.000`: POS money without the `Rp`, which the layout prints separately. */
export const money = (value: number) => idr.format(value);

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cx("rounded-[5px] border border-line bg-panel px-1.5 py-px font-sans text-[11px] text-muted", className)}>
      {children}
    </kbd>
  );
}

/** The pill used across the POS top bar. */
export function Chip({ children, className, ...props }: { children: ReactNode; className?: string; onClick?: () => void; title?: string | undefined }) {
  const Tag = props.onClick ? "button" : "span";
  return (
    <Tag
      type={props.onClick ? "button" : undefined}
      className={cx("flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1 whitespace-nowrap text-muted", className)}
      {...props}
    >
      {children}
    </Tag>
  );
}
