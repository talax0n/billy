import {
  approvalKindLabels,
  type AuditAction,
  auditActionNames,
  auditActions,
  auditSourceLabels,
  roleLabels,
} from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import type { InferResponseType } from "hono/client";
import { useState } from "react";
import { type Period, PeriodFilter, periodQuery, presetPeriod } from "../../components/period-filter.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Sheet } from "../../components/ui/dialog.tsx";
import { Select } from "../../components/ui/field.tsx";
import { EmptyState, FilterRow, PageBody, PageHeader } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";

type AuditRow = InferResponseType<typeof api.audit.$get, 200>["rows"][number];

const stamp = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Jakarta" });
const time = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
const actionLabel = (action: string) => auditActions[action as AuditAction]?.label ?? action;

/** Filters a link can open the log with, e.g. a watchdog flag: `?actorId=…&action=…&from=…&to=…`. */
interface AuditSearch {
  actorId?: string;
  action?: AuditAction;
  from?: string;
  to?: string;
}

/**
 * Log Aktivitas: every change anyone made, newest first. Admin only. Rows cannot be edited or
 * deleted, here or in the database.
 */
export function AuditPage() {
  const search: AuditSearch = useSearch({ strict: false });
  return <AuditLog key={JSON.stringify(search)} search={search} />;
}

function AuditLog({ search }: { search: AuditSearch }) {
  const [period, setPeriod] = useState<Period>(() =>
    search.from ? { preset: "custom", from: search.from, to: search.to ?? "" } : presetPeriod("last30"),
  );
  const [actorId, setActorId] = useState(search.actorId ?? "");
  const [action, setAction] = useState<AuditAction | "">(search.action ?? "");
  const [open, setOpen] = useState<AuditRow | null>(null);
  const people = useQuery({ queryKey: ["users", "all"], queryFn: () => unwrap(api.users.$get({ query: { pageSize: "100" } })) });
  const paged = usePagedQuery(["audit", period, actorId, action], (params) =>
    unwrap(
      api.audit.$get({
        query: {
          q: params.q,
          page: String(params.page),
          pageSize: String(params.pageSize),
          ...periodQuery(period),
          ...(actorId && { actorId }),
          ...(action && { action }),
        },
      }),
    ),
  );
  const filter = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    paged.setPage(1);
  };

  return (
    <>
      <PageHeader title="Log Aktivitas" />
      <PageBody>
        <FilterRow aside={paged.query.data && `${paged.query.data.total} kejadian`}>
          <PeriodFilter value={period} onChange={filter(setPeriod)} />
          <Select className="w-44" aria-label="Orang" value={actorId} onChange={(e) => filter(setActorId)(e.target.value)}>
            <option value="">Semua orang</option>
            {people.data?.rows.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({roleLabels[u.role]})
              </option>
            ))}
          </Select>
          <Select className="w-52" aria-label="Aksi" value={action} onChange={(e) => filter(setAction)(e.target.value as AuditAction | "")}>
            <option value="">Semua aksi</option>
            {auditActionNames.map((name) => (
              <option key={name} value={name}>
                {auditActions[name].label}
              </option>
            ))}
          </Select>
        </FilterRow>
        <DataTable
          paged={paged}
          searchPlaceholder="Cari ringkasan atau nomor nota…"
          onRowClick={setOpen}
          empty={<EmptyState title="Tidak ada aktivitas" description="Ubah filter atau periode." />}
          columns={[
            { header: "Ringkasan", cell: (r) => r.summary },
            { header: "Orang", className: "whitespace-nowrap", cell: (r) => r.actorName ?? <span className="text-muted">Tidak dikenal</span> },
            { header: "Aksi", cell: (r) => <span className="text-ink-2">{actionLabel(r.action)}</span> },
            {
              header: "Sumber",
              mobile: false,
              cell: (r) => (
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={r.source === "kasir_offline" ? "warn" : "neutral"}>{auditSourceLabels[r.source]}</Badge>
                  {r.approval?.id && !r.action.startsWith("approval.") && <Badge tone="up">Disetujui</Badge>}
                </span>
              ),
            },
            {
              header: "Waktu",
              align: "right",
              className: "whitespace-nowrap",
              cell: (r) => <span className="text-ink-2 tabular-nums">{time.format(new Date(r.at))}</span>,
            },
          ]}
        />
      </PageBody>
      {open && <EventSheet event={open} onClose={() => setOpen(null)} />}
    </>
  );
}

const show = (value: unknown) =>
  value === undefined ? "—" : value === null ? "kosong" : typeof value === "object" ? JSON.stringify(value) : String(value);

function EventSheet({ event, onClose }: { event: AuditRow; onClose: () => void }) {
  const before = (event.before ?? {}) as Record<string, unknown>;
  const after = (event.after ?? {}) as Record<string, unknown>;
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const facts: [string, string][] = [
    ["Waktu", stamp.format(new Date(event.at))],
    ["Orang", `${event.actorName ?? "Tidak dikenal"}${event.actorRole ? ` (${roleLabels[event.actorRole]})` : ""}`],
    ["Sumber", `${auditSourceLabels[event.source]}${event.deviceCode ? ` · ${event.deviceCode}` : ""}`],
    ["Data", `${event.entityType} ${event.entityId}`],
  ];
  if (event.reason) facts.push(["Alasan", event.reason]);
  if (event.approval?.id && !event.action.startsWith("approval.")) {
    facts.push([
      "Persetujuan",
      `${event.approval.kind ? approvalKindLabels[event.approval.kind] : ""} · ${event.approval.method === "pin" ? "PIN" : "dari jauh"} oleh ${event.approval.approverName ?? "admin"}`,
    ]);
  }

  return (
    <Sheet open onClose={onClose} title={actionLabel(event.action)} description={event.summary}>
      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-1.5 max-md:grid-cols-1">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd className="break-words max-md:mb-1">{value}</dd>
            </div>
          ))}
        </dl>
        {fields.length > 0 && (
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="w-1/4 py-2 font-normal">Kolom</th>
                <th className="py-2 font-normal">Sebelum</th>
                <th className="py-2 font-normal">Sesudah</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr key={field} className="border-b border-line-2 align-top">
                  <td className="py-2 pr-2 text-ink-2 break-words">{field}</td>
                  <td className="py-2 pr-2 break-words text-muted">{show(before[field])}</td>
                  <td className="py-2 break-words">{show(after[field])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Sheet>
  );
}
