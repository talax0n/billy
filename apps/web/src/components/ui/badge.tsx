import { type InvoiceState, invoiceStatusLabel } from "@billy/core";
import type { ReactNode } from "react";
import { cx } from "../../lib/cx.ts";

const dotClass = { neutral: "bg-faint", up: "bg-up", down: "bg-down", warn: "bg-warn" };

/** Small bordered tag with a coloured dot. Colour carries meaning only. */
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof dotClass; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line px-1.5 py-px text-xs whitespace-nowrap text-ink-2">
      <span className={cx("size-1.5 rounded-full", dotClass[tone])} />
      {children}
    </span>
  );
}

/** Invoice status in the fixed glossary: Lunas, Sebagian, Belum bayar, Telat, Void. */
export function StatusTag({ state }: { state: Pick<InvoiceState, "status" | "overdue"> }) {
  const tone = state.status === "void" ? "neutral" : state.status === "paid" ? "up" : state.overdue ? "down" : "warn";
  return <Badge tone={tone}>{invoiceStatusLabel(state)}</Badge>;
}
