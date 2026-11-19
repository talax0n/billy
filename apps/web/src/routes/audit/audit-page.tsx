import {
  approvalKindLabels,
  type AuditAction,
  auditActionNames,
  auditActions,
  auditSourceLabels,
  formatRupiah,
  roleLabels,
  rupiah,
} from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import type { InferResponseType } from "hono/client";
import {
  BadgeCheck,
  FileText,
  Files,
  type LucideIcon,
  LogIn,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  Store,
  Truck,
  UserRound,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { type Period, PeriodFilter, periodQuery, presetPeriod } from "../../components/period-filter.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Sheet } from "../../components/ui/dialog.tsx";
import { Select } from "../../components/ui/field.tsx";
import { EmptyState, FilterRow, PageBody, PageHeader } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";

type AuditRow = InferResponseType<typeof api.audit.$get, 200>["rows"][number];

const stamp = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Jakarta" });
const clock = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
const dayLong = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
const dayKey = (at: Date | string) => new Date(at).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const actionLabel = (action: string) => auditActions[action as AuditAction]?.label ?? action;

/** Red: something undone or refused. Amber: something changed after the fact. The rest is routine. */
type Tone = "down" | "warn" | "neutral";
const toneOf = (action: string): Tone =>
  /\.(void|cancel|login_failed|pin_failed|pin_locked|reject)$/.test(action)
    ? "down"
    : /(price_change|\.edit|\.revise|stock\.adjust|limits\.update|\.requeue)$/.test(action)
      ? "warn"
      : "neutral";
const toneClass: Record<Tone, string> = {
  down: "bg-down/12 text-down",
  warn: "bg-warn/15 text-warn",
  neutral: "bg-line-2 text-ink-2",
};

/** Icon by the area an action belongs to, its first segment. */
const areaIcons: Record<string, LucideIcon> = {
  auth: LogIn,
  user: UserRound,
  approval_pin: UserRound,
  contact: UserRound,
  settings: Settings,
  category: Package,
  product: Package,
  stock: Package,
  account: Wallet,
  cash: Wallet,
  expense: Wallet,
  sales: Receipt,
  purchase: ShoppingCart,
  invoice_bundle: Files,
  pos: Store,
  quotation: FileText,
  approval: BadgeCheck,
  driver: Truck,
  delivery: Truck,
};

/** Pages that open a record from `?id=`, by the audit event's entity type. */
const documentPaths: Record<string, { label: string; path: string }> = {
  sales_invoice: { label: "Buka faktur", path: "/penjualan" },
  purchase_invoice: { label: "Buka pembelian", path: "/pembelian" },
  pos_sale: { label: "Buka nota kasir", path: "/riwayat-kasir" },
  expense: { label: "Buka biaya", path: "/biaya" },
  stock_opname: { label: "Buka opname", path: "/stok-opname" },
  quotation: { label: "Buka penawaran", path: "/penawaran" },
  invoice_bundle: { label: "Buka tukar faktur", path: "/tukar-faktur" },
};

function dayHeading(key: string) {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const long = dayLong.format(new Date(`${key}T12:00:00+07:00`));
  return key === today ? `Hari ini · ${long}` : key === yesterday ? `Kemarin · ${long}` : long;
}

function EventIcon({ action, size = "md" }: { action: string; size?: "md" | "sm" }) {
  const Icon = areaIcons[action.split(".")[0]!] ?? FileText;
  return (
    <span className={cx("grid shrink-0 place-items-center rounded-full", toneClass[toneOf(action)], size === "md" ? "size-8" : "size-6")}>
      <Icon className={size === "md" ? "size-4" : "size-3"} />
    </span>
  );
}

/** The page's events in day groups, one line each: time, what happened, who and from where. */
function Timeline({ rows, onOpen }: { rows: AuditRow[]; onOpen: (row: AuditRow) => void }) {
  const days: { key: string; rows: AuditRow[] }[] = [];
  for (const row of rows) {
    const key = dayKey(row.at);
    if (days.at(-1)?.key === key) days.at(-1)!.rows.push(row);
    else days.push({ key, rows: [row] });
  }
  return days.map((day) => (
    <section key={day.key}>
      <h2 className="border-b border-line bg-line-2 px-4 py-2 text-xs font-medium text-ink-2">{dayHeading(day.key)}</h2>
      <ol>
        {day.rows.map((r) => {
          const tone = toneOf(r.action);
          return (
            <li key={r.id} className="border-b border-line-2 last:border-b-0">
              <button
                type="button"
                onClick={() => onOpen(r)}
                className={cx(
                  "flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-line-2 max-md:flex-wrap",
                  tone === "down" && "border-l-2 border-l-down",
                  tone === "warn" && "border-l-2 border-l-warn",
                )}
              >
                <span className="w-11 shrink-0 text-ink-2 tabular-nums">{clock.format(new Date(r.at))}</span>
                <EventIcon action={r.action} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cx("font-medium", tone === "down" && "text-down")}>{actionLabel(r.action)}</span>
                  <span className="truncate text-ink-2">
                    {r.summary}
                    {r.reason && <span className="text-muted"> · alasan: “{r.reason}”</span>}
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 max-md:w-full max-md:justify-start max-md:pl-14">
                  <span className="mr-1 font-medium">{r.actorName ?? <span className="text-muted">Tidak dikenal</span>}</span>
                  <Badge tone={r.source === "kasir_offline" ? "warn" : "neutral"}>
                    {auditSourceLabels[r.source]}
                    {r.deviceCode && ` · ${r.deviceCode}`}
                  </Badge>
                  {r.approval?.id && !r.action.startsWith("approval.") && <Badge tone="up">Disetujui</Badge>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  ));
}

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
          empty={<EmptyState title="Tidak ada aktivitas" description="Ubah filter atau periode." />}
          columns={[]}
          body={(rows) => <Timeline rows={rows} onOpen={setOpen} />}
        />
      </PageBody>
      {open && <EventSheet key={open.id} event={open} onOpen={setOpen} onClose={() => setOpen(null)} />}
    </>
  );
}

const fieldLabels: Record<string, string> = {
  date: "Tanggal",
  dueDate: "Jatuh tempo",
  termsDays: "Tempo (hari)",
  number: "Nomor",
  lines: "Barang",
  subtotal: "Subtotal",
  discountAmount: "Diskon",
  shippingFee: "Ongkir",
  total: "Total",
  amount: "Jumlah",
  price: "Harga",
  unitPrice: "Harga satuan",
  qty: "Jumlah",
  stock: "Stok",
  note: "Catatan",
  name: "Nama",
  username: "Nama pengguna",
  role: "Peran",
  active: "Aktif",
  method: "Cara bayar",
  voidedAt: "Dibatalkan",
};
const isMoney = (field: string) => /(total|amount|price|fee|cost)$/i.test(field);
/** Ids and secrets mean nothing to a reader; the record itself is one tap away. */
const hidden = (field: string) => /(Ids?|password|Hash)$/.test(field) || field === "id";
const isTimestamp = (value: string) => /^\d{4}-\d\d-\d\dT/.test(value);

function show(field: string, value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "kosong";
  if (typeof value === "boolean") return value ? "Ya" : "Tidak";
  if (typeof value === "number") return isMoney(field) ? formatRupiah(rupiah(value)) : String(value);
  if (typeof value === "string") return isTimestamp(value) ? stamp.format(new Date(value)) : value;
  if (Array.isArray(value) && value.every((v) => v && typeof v === "object" && "qty" in v && "unitPrice" in v)) {
    return value
      .map((v: { qty: number; unitPrice: number; discountAmount?: number }) =>
        `${v.qty} × ${formatRupiah(rupiah(v.unitPrice))}${v.discountAmount ? ` (diskon ${formatRupiah(rupiah(v.discountAmount))})` : ""}`,
      )
      .join("\n");
  }
  return JSON.stringify(value);
}

function EventSheet({ event, onOpen, onClose }: { event: AuditRow; onOpen: (row: AuditRow) => void; onClose: () => void }) {
  const doc = documentPaths[event.entityType];
  const before = (event.before ?? {}) as Record<string, unknown>;
  const after = (event.after ?? {}) as Record<string, unknown>;
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((f) => !hidden(f));
  const edited = event.before !== null && event.before !== undefined;
  const changed = (f: string) => edited && f in before && JSON.stringify(before[f]) !== JSON.stringify(after[f]);
  const facts: [string, string][] = [
    ["Waktu", stamp.format(new Date(event.at))],
    ["Orang", `${event.actorName ?? "Tidak dikenal"}${event.actorRole ? ` (${roleLabels[event.actorRole]})` : ""}`],
    ["Sumber", `${auditSourceLabels[event.source]}${event.deviceCode ? ` · ${event.deviceCode}` : ""}`],
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
        {doc && (
          <Link to={doc.path} search={{ id: event.entityId }} className="self-start text-ink-2 underline hover:text-ink">
            {doc.label} →
          </Link>
        )}
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
                <th className="w-1/4 py-2 pl-2 font-normal">Data</th>
                {edited && <th className="py-2 font-normal">Sebelum</th>}
                <th className="py-2 font-normal">{edited ? "Sesudah" : "Isi"}</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr key={field} className={cx("border-b border-line-2 align-top", changed(field) && "bg-warn-bg")}>
                  <td className="py-2 pr-2 pl-2 text-ink-2 break-words">{fieldLabels[field] ?? field}</td>
                  {edited && (
                    <td className={cx("py-2 pr-2 break-words whitespace-pre-line tabular-nums", changed(field) ? "text-muted line-through" : "text-muted")}>
                      {show(field, before[field])}
                    </td>
                  )}
                  <td className={cx("py-2 pr-2 break-words whitespace-pre-line tabular-nums", changed(field) && "font-medium")}>{show(field, after[field])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <RecordHistory event={event} onOpen={onOpen} />
      </div>
    </Sheet>
  );
}

/** Every event on the same record, so a faktur or a user can be followed from start to now. */
function RecordHistory({ event, onOpen }: { event: AuditRow; onOpen: (row: AuditRow) => void }) {
  const history = useQuery({
    queryKey: ["audit", "record", event.entityId],
    queryFn: () => unwrap(api.audit.$get({ query: { entityId: event.entityId, pageSize: "100" } })),
  });
  const rows = history.data?.rows ?? [];
  if (rows.length < 2) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">Riwayat data ini</h3>
      <ol className="flex flex-col">
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onOpen(r)}
              disabled={r.id === event.id}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-line-2 disabled:bg-line-2"
            >
              <EventIcon action={r.action} size="sm" />
              <span className="min-w-0 flex-1 truncate">
                {actionLabel(r.action)} <span className="text-muted">· {r.actorName ?? "Tidak dikenal"}</span>
              </span>
              <span className="shrink-0 text-xs text-muted tabular-nums">{stamp.format(new Date(r.at))}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
