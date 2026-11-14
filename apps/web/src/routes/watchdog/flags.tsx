import { addDays, businessDate, type WatchdogFlag, watchdogFlagLabels, type WatchdogTarget } from "@billy/core";
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, unwrap } from "../../lib/api.ts";
import { meQuery } from "../../lib/auth.ts";
import { cx } from "../../lib/cx.ts";

/** Today and the six days before: the Overview card and the bell share this one request. */
export function recentFlagsOptions(today = businessDate()) {
  const from = addDays(today, -6);
  return queryOptions({
    queryKey: ["watchdog", from, today],
    queryFn: () => unwrap(api.watchdog.$get({ query: { from, to: today } })),
    refetchInterval: 60_000,
  });
}

/** The page a flag opens, each filtered to its document, person or day. */
export function flagLink(target: WatchdogTarget): { to: string; search: Record<string, string> } {
  switch (target.type) {
    case "pos_sale":
      return { to: "/riwayat-kasir", search: { id: target.id } };
    case "sales_invoice":
      return { to: "/penjualan", search: { id: target.id } };
    case "opname":
      return { to: "/stok-opname", search: { id: target.id } };
    case "audit":
      return {
        to: "/log-aktivitas",
        search: { ...(target.actorId && { actorId: target.actorId }), ...(target.action && { action: target.action }), from: target.date, to: target.date },
      };
  }
}

const time = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

export function FlagItem({ flag, onNavigate }: { flag: WatchdogFlag; onNavigate?: () => void }) {
  const link = flagLink(flag.target);
  return (
    <Link to={link.to} search={link.search} onClick={onNavigate} className="flex flex-col items-start gap-1 px-4 py-3 hover:bg-line-2">
      <span className={cx("text-xs font-medium", flag.severity === "high" ? "text-down" : "text-warn")}>{watchdogFlagLabels[flag.type]}</span>
      <span className="font-medium">{flag.message}</span>
      <span className="text-xs text-muted">
        {flag.who?.name ?? "Tidak dikenal"} · {time.format(new Date(flag.at))}
      </span>
    </Link>
  );
}

/** Overview, admin only: today's red flags and the count over the last 7 days. */
export function WatchdogCard({ className }: { className: string }) {
  const { data: me } = useSuspenseQuery(meQuery);
  const today = businessDate();
  const { data } = useQuery({ ...recentFlagsOptions(today), enabled: me?.role === "admin" });
  if (me?.role !== "admin" || !data) return null;
  const todays = data.rows.filter((f) => f.date === today);
  return (
    <section aria-label="Peringatan" className={cx(className, "flex flex-col px-0 pb-0")}>
      <div className="flex items-start justify-between gap-2.5 px-5">
        <h2>Peringatan</h2>
        <Link className="text-xs text-muted" to="/ringkasan-harian">
          {data.rows.length} dalam 7 hari ›
        </Link>
      </div>
      {todays.length ? (
        <ul className="mt-2 max-h-80 overflow-y-auto border-t border-line-2">
          {todays.map((flag) => (
            <li key={flag.id} className="border-b border-line-2 last:border-b-0">
              <FlagItem flag={flag} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 pt-3 pb-[18px] text-muted">Tidak ada peringatan hari ini.</p>
      )}
    </section>
  );
}
