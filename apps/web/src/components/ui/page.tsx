import type { ReactNode } from "react";
import { cx } from "../../lib/cx.ts";

/** Top of a page inside the main panel: title, one-line description, actions on the right. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
      <div>
        <h1 className="text-[23px] font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Padded content area under a PageHeader. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex flex-col gap-4 px-6 pt-4 pb-6", className)}>{children}</div>;
}

/** Filters on the left, an "as of" note or count on the right. */
export function FilterRow({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {aside && <div className="ml-auto text-muted">{aside}</div>}
    </div>
  );
}

const toneClass = { neutral: "text-muted", up: "text-up", down: "text-down", warn: "text-warn" };

/** A KPI: label, big number, a small coloured delta or note, and a muted footnote. */
export function StatTile({
  label,
  value,
  delta,
  tone = "neutral",
  note,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  tone?: keyof typeof toneClass;
  note?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line px-4 py-3.5">
      <div className="text-ink-2">{label}</div>
      <div className="mt-2 mb-1 flex items-baseline gap-2 text-[27px] font-medium tracking-tight whitespace-nowrap tabular-nums">
        <span>{value}</span>
        {delta && <small className={cx("text-[13px] font-medium tracking-normal", toneClass[tone])}>{delta}</small>}
      </div>
      {note && <div className="text-xs text-muted">{note}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
