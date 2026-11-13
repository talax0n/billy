import { actionRegistry } from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ActionStatus, actionDescription, topActionsOptions } from "../../routes/insights/actions.tsx";
import { Button } from "../ui/button.tsx";

/** "Perlu Tindakan" as a notification bell: the count on the icon, the top five in a panel. */
export function NotificationBell() {
  const { data } = useQuery(topActionsOptions);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const count = data?.total ?? 0;

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
            <p className="px-4 py-8 text-center text-muted">Semua sudah beres.</p>
          )}
          <Link to="/tindakan" onClick={() => setOpen(false)} className="block border-t border-line px-4 py-2.5 text-center font-medium hover:bg-line-2">
            Lihat semua
          </Link>
        </div>
      )}
    </div>
  );
}
