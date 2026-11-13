import { actionRegistry, businessDate } from "@billy/core";
import { queryOptions, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { InferResponseType } from "hono/client";
import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, unwrap } from "../../lib/api.ts";
import { meQuery } from "../../lib/auth.ts";
import { ActionStatus, actionDescription, topActionsOptions } from "../../routes/insights/actions.tsx";
import { FlagItem, recentFlagsOptions } from "../../routes/watchdog/flags.tsx";
import { Button } from "../ui/button.tsx";
import { toast } from "../ui/toast.tsx";

type PendingApproval = InferResponseType<typeof api.approvals.pending.$get, 200>["rows"][number];

/** A kasir is waiting at the counter, so the admin's bell checks often. */
const pendingApprovalsOptions = queryOptions({
  queryKey: ["approvals", "pending"],
  queryFn: () => unwrap(api.approvals.pending.$get()),
  refetchInterval: 5_000,
});

/**
 * "Perlu Tindakan" as a notification bell: the count on the icon, the top five in a panel.
 * For admin, remote approval requests sit above them and are decided right here, then today's
 * red flags from the watchdog.
 */
export function NotificationBell() {
  const { data } = useQuery(topActionsOptions);
  const { data: me } = useSuspenseQuery(meQuery);
  const approvals = useQuery({ ...pendingApprovalsOptions, enabled: me?.role === "admin" });
  const pending = approvals.data?.rows ?? [];
  const today = businessDate();
  const watchdog = useQuery({ ...recentFlagsOptions(today), enabled: me?.role === "admin" });
  const flags = watchdog.data?.rows.filter((f) => f.date === today) ?? [];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const count = (data?.total ?? 0) + pending.length + flags.length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        aria-label={`Perlu tindakan: ${count}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Bell className="size-[18px]" />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-down px-1 text-[11px] leading-none font-semibold text-panel tabular-nums">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute top-full right-0 z-20 mt-2 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-panel shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <b className="font-semibold">Perlu Tindakan</b>
            <span className="text-xs text-muted">{count} tindakan</span>
          </div>
          {pending.length > 0 && (
            <ul aria-label="Minta persetujuan" className="border-b border-line bg-warn-bg/40">
              {pending.map((request) => (
                <ApprovalRequest key={request.id} request={request} />
              ))}
            </ul>
          )}
          {flags.length > 0 && (
            <div className="border-b border-line">
              <ul aria-label="Peringatan hari ini" className="max-h-[30vh] overflow-y-auto">
                {flags.slice(0, 5).map((flag) => (
                  <li key={flag.id} className="border-b border-line-2 last:border-b-0">
                    <FlagItem flag={flag} onNavigate={() => setOpen(false)} />
                  </li>
                ))}
              </ul>
              <Link to="/ringkasan-harian" onClick={() => setOpen(false)} className="block px-4 py-2 text-xs text-muted hover:bg-line-2">
                {flags.length > 5 ? `${flags.length - 5} peringatan lain · ` : ""}Ringkasan harian ›
              </Link>
            </div>
          )}
          {data?.rows.length ? (
            <ul className="max-h-[60vh] overflow-y-auto">
              {data.rows.map((item, i) => (
                <li key={i} className="border-b border-line-2 last:border-b-0">
                  <Link
                    to={actionRegistry[item.kind].target}
                    onClick={() => setOpen(false)}
                    className="flex flex-col items-start gap-1 px-4 py-3 hover:bg-line-2"
                  >
                    <ActionStatus item={item} />
                    <span className="font-medium">{item.name}</span>
                    <span className="text-xs text-muted">{actionDescription(item)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            pending.length === 0 &&
            flags.length === 0 && <p className="px-4 py-8 text-center text-muted">Semua sudah beres.</p>
          )}
          <Link to="/tindakan" onClick={() => setOpen(false)} className="block border-t border-line px-4 py-2.5 text-center font-medium hover:bg-line-2">
            Lihat semua
          </Link>
        </div>
      )}
    </div>
  );
}

const clock = new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: "Asia/Jakarta" });

function ApprovalRequest({ request }: { request: PendingApproval }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    try {
      await unwrap(api.approvals[":id"][decision].$post({ param: { id: request.id } }));
      toast(decision === "approve" ? "Disetujui" : "Ditolak", decision === "approve" ? "up" : "neutral");
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      toast(err.message, "down");
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: pendingApprovalsOptions.queryKey });
    }
  }
  return (
    <li className="flex flex-col gap-2 border-b border-line-2 px-4 py-3 last:border-b-0">
      <span className="text-xs font-medium text-warn">Minta persetujuan</span>
      <span className="font-medium">{request.summary}</span>
      <span className="text-xs text-muted">
        {request.requestedByName}
        {request.deviceCode && ` · ${request.deviceCode}`} · {clock.format(new Date(request.createdAt))}, berlaku sampai{" "}
        {clock.format(new Date(request.expiresAt))}
      </span>
      <span className="flex gap-2">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void decide("approve")} aria-label={`Setujui ${request.summary}`}>
          Setujui
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void decide("reject")} aria-label={`Tolak ${request.summary}`}>
          Tolak
        </Button>
      </span>
    </li>
  );
}
