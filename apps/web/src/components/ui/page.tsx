import { Link } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext } from "react";
import { cx } from "../../lib/cx.ts";
import { NotificationBell } from "../shell/notification-bell.tsx";

/** Set by the shell when the current page is one tab of a sidebar entry (e.g. Penjualan → Nota Kasir). */
export const SectionContext = createContext<{ title: string; tabs: { path: string; label: string }[] } | null>(null);

/**
 * Top of a page inside the main panel: the title, then actions and the notification bell on the right.
 * A page that is a tab of a section shows the section's name and its tab strip instead of its own title;
 * a `detail` view (one record) keeps its own title and no strip.
 */
export function PageHeader({ title, actions, detail }: { title: string; actions?: ReactNode; detail?: boolean }) {
  const tabbed = useContext(SectionContext);
  const section = detail ? null : tabbed;
  return (
    <header
      className={cx(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-6 pt-5 pb-4 max-md:px-4 max-md:pt-4 max-md:pb-3",
        section && "pb-0! max-md:pb-0!",
      )}
    >
      <h1 className="text-[23px] font-semibold tracking-tight max-md:text-xl">{section?.title ?? title}</h1>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {/* Phones show the bell in the shell's top bar. */}
        <div className="max-md:hidden">
          <NotificationBell />
        </div>
      </div>
      {section && (
        <nav aria-label={section.title} className="-mb-px flex w-full gap-5 overflow-x-auto max-md:gap-4">
          {section.tabs.map((tab) => (
            <Link
              key={tab.path}
              to={tab.path}
              activeOptions={{ exact: true }}
              className="shrink-0 border-b-2 border-transparent pt-1 pb-2.5 whitespace-nowrap text-muted hover:text-ink"
              activeProps={{ className: "border-ink! font-medium text-ink!", "aria-current": "page" }}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

/** Padded content area under a PageHeader. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex flex-col gap-4 px-6 pt-4 pb-6 max-md:px-4", className)}>{children}</div>;
}

/** Filters on the left, an "as of" note or count on the right. */
export function FilterRow({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 max-md:grid max-md:grid-cols-2 max-md:[&>*]:w-full max-md:[&>*]:max-w-none">
      {children}
      {aside && <div className="ml-auto text-muted max-md:col-span-2 max-md:text-xs">{aside}</div>}
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
    <div className="min-w-0 rounded-xl border border-line px-4 py-3.5 max-md:px-3 max-md:py-2.5">
      <div className="text-ink-2">{label}</div>
      <div className="mt-2 mb-1 flex items-baseline gap-2 text-[27px] font-medium tracking-tight whitespace-nowrap tabular-nums max-md:mt-1 max-md:text-lg">
        <span>{value}</span>
        {delta && <small className={cx("text-sm font-medium tracking-normal", toneClass[tone])}>{delta}</small>}
      </div>
      {/* The filter row above already names the period on phones. */}
      {note && <div className="text-xs text-muted max-md:hidden">{note}</div>}
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
