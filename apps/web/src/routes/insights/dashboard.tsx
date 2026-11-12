import {
  businessDate,
  formatDate,
  formatRupiah,
  periodWindow,
  rupiah,
  type InsightPeriod,
} from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { InferResponseType } from "hono/client";
import { useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { DateInput, Select } from "../../components/ui/field.tsx";
import { FilterRow, PageBody, PageHeader } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";
import { ActionLink, ActionStatus, actionDescription, linkButton } from "./actions.tsx";

type Dashboard = InferResponseType<typeof api.insights.dashboard.$get, 200>;
const card = "min-w-0 rounded-xl border border-line px-5 py-[18px] [&_h2]:text-sm [&_h2]:font-medium";
const bigValue = "mt-2 mb-1 text-[27px] font-medium tracking-[-0.02em] tabular-nums max-[1200px]:text-[23px]";
const short = (n: number) => formatRupiah(rupiah(n), { compact: true });
/** Compact amount with the decimals and unit dimmed: `Rp 51,5 jt`. */
function ShortMoney({ value }: { value: number }) {
  const [, main, rest] = /^(.*?)((?:,\d+)?(?: jt| M)?)$/.exec(short(value))!;
  return (
    <span title={formatRupiah(rupiah(value))}>
      {main}
      <span className="text-faint">{rest}</span>
    </span>
  );
}
function Delta({
  value,
  inverse = false,
}: {
  value: Dashboard["deltas"]["sales"];
  inverse?: boolean;
}) {
  const tone =
    value.amount === 0
      ? "text-muted"
      : value.amount > 0 !== inverse
        ? "text-up"
        : "text-down";
  return (
    <span className={tone} title={`Selisih ${formatRupiah(value.amount)}`}>
      {value.amount > 0 ? "↑" : value.amount < 0 ? "↓" : "—"}{" "}
      {value.percent === null
        ? "Baru"
        : `${Math.abs(value.percent).toLocaleString("id-ID")}%`}
    </span>
  );
}
type Point = [x: number, y: number];
/**
 * Monotone cubic through every point (the d3 `monotoneX` tangents): a curve that never
 * overshoots its neighbours, so weeks with zero cash stay on the axis instead of dipping below.
 */
function monotonePath(points: Point[]) {
  const slope = (i: number) =>
    (points[i + 1]![1] - points[i]![1]) / (points[i + 1]![0] - points[i]![0]);
  const tangents = points.map((_, i) => {
    if (i === 0) return slope(0);
    if (i === points.length - 1) return slope(i - 1);
    const [s0, s1] = [slope(i - 1), slope(i)];
    return (
      (Math.sign(s0) + Math.sign(s1)) *
      Math.min(Math.abs(s0), Math.abs(s1), Math.abs(s0 + s1) / 4)
    );
  });
  return points
    .map(([x, y], i) => {
      if (i === 0) return `M${x},${y}`;
      const [px, py] = points[i - 1]!;
      const h = (x - px) / 3;
      return `C${px + h},${py + tangents[i - 1]! * h} ${x - h},${y - tangents[i]! * h} ${x},${y}`;
    })
    .join(" ");
}
/** Pushes two end labels at least `gap` apart around their midpoint, inside [top, bottom]. */
function spreadLabels(a: number, b: number, gap: number, top: number, bottom: number) {
  if (Math.abs(a - b) >= gap) return [a, b] as const;
  const mid = Math.min(Math.max((a + b) / 2, top + gap / 2), bottom - gap / 2);
  return a <= b ? ([mid - gap / 2, mid + gap / 2] as const) : ([mid + gap / 2, mid - gap / 2] as const);
}
const plot = { left: 64, right: 520, top: 50, bottom: 290 };
function CashChart({ rows }: { rows: Dashboard["chart"] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.incoming, r.outgoing]));
  const x = (i: number) => plot.left + (i * (plot.right - plot.left)) / (rows.length - 1);
  const y = (value: number) => plot.bottom - (value / max) * (plot.bottom - plot.top);
  const path = (key: "incoming" | "outgoing") => monotonePath(rows.map((r, i) => [x(i), y(r[key])]));
  const last = rows.at(-1)!;
  const [incomingY, outgoingY] = spreadLabels(y(last.incoming), y(last.outgoing), 28, plot.top, plot.bottom);
  return (
    <svg
      className="mt-5 min-h-[330px] w-full overflow-visible text-[11px] tabular-nums [&_text]:fill-muted"
      viewBox="0 0 660 330"
      role="img"
      aria-label="Arus kas mingguan: uang masuk dan keluar, tanpa transfer"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line x1={plot.left} x2={plot.right} y1={plot.top + i * 60} y2={plot.top + i * 60} stroke="var(--line-2)" />
          <text x="0" y={plot.top + 4 + i * 60}>
            {short(Math.round((max * (4 - i)) / 4))}
          </text>
        </g>
      ))}
      <path d={path("outgoing")} fill="none" stroke="var(--faint)" strokeWidth="1.8" />
      <path d={path("incoming")} fill="none" stroke="var(--ink)" strokeWidth="2.2" />
      {rows.map((r, i) => (
        <g key={r.from}>
          <circle cx={x(i)} cy={y(r.outgoing)} r="3" fill="var(--faint)">
            <title>
              {formatDate(r.from)} · Keluar {formatRupiah(r.outgoing)}
            </title>
          </circle>
          <circle cx={x(i)} cy={y(r.incoming)} r="3" fill="var(--ink)">
            <title>
              {formatDate(r.from)} · Masuk {formatRupiah(r.incoming)}
            </title>
          </circle>
          {(i % Math.ceil(rows.length / 5) === 0 || i === rows.length - 1) && (
            <text x={x(i)} y="318" textAnchor="middle">
              {formatDate(r.from).replace(/ \d{4}$/, "")}
            </text>
          )}
        </g>
      ))}
      <rect x="531" y={incomingY - 12} width="125" height="24" rx="12" fill="var(--ink)" />
      <text x="541" y={incomingY + 4} style={{ fill: "var(--panel)" }}>
        Masuk {short(last.incoming)}
      </text>
      <text x="541" y={outgoingY + 4}>
        Keluar {short(last.outgoing)}
      </text>
    </svg>
  );
}
export function DashboardPage() {
  const today = businessDate();
  const [period, setPeriod] = useState<InsightPeriod>("month");
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`),
    [to, setTo] = useState(today);
  const [account, setAccount] = useState("");
  const [weeks, setWeeks] = useState<"12" | "26">("12");
  const invalid =
    period === "custom" &&
    (!from ||
      !to ||
      from > to ||
      Date.parse(to) - Date.parse(from) > 366 * 86400000);
  const window = invalid
    ? { from, to }
    : periodWindow(period, today, { from, to });
  const query = { ...window, weeks, ...(account ? { account } : {}) };
  const result = useQuery({
    queryKey: ["insights", "dashboard", query],
    queryFn: () => unwrap(api.insights.dashboard.$get({ query })),
    enabled: !invalid,
    refetchInterval: 60000,
  });
  const data = result.data;
  const range = !invalid
    ? `${formatDate(window.from)}–${formatDate(window.to)}`
    : "Rentang tanggal";
  const selected =
    data?.balances.find((a) => a.id === account)?.name ?? "semua akun";
  const exportQuery = new URLSearchParams({
    ...window,
    ...(account ? { account } : {}),
  }).toString();
  return (
    <>
      <PageHeader
        title="Ringkasan"
        description={`Kondisi toko · ${range}`}
        actions={
          data && (
            <div className="flex gap-2.5 rounded-full border border-line px-3.5 py-[7px] whitespace-nowrap text-muted max-[900px]:flex-wrap max-[900px]:whitespace-normal">
              Saldo kas & bank <b className="font-medium text-ink">{formatRupiah(data.totalBalance)}</b>
              <span>
                · {data.balances.filter((a) => a.kind !== "ewallet").length}{" "}
                akun
              </span>
            </div>
          )
        }
      />
      <PageBody className="gap-3.5">
        <FilterRow
          aside={
            data
              ? `Data per ${new Date(data.asOf).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })} WIB`
              : "Memuat data…"
          }
        >
          <div className="w-36">
            <Select aria-label="Periode" value={period} onChange={(e) => setPeriod(e.target.value as InsightPeriod)}>
              <option value="month">Bulan ini</option>
              <option value="last-month">Bulan lalu</option>
              <option value="30-days">30 hari</option>
              <option value="custom">Tanggal khusus</option>
            </Select>
          </div>
          {period === "custom" && (
            <div className="flex w-80 gap-2">
              <DateInput aria-label="Dari tanggal" value={from} onChange={(e) => setFrom(e.target.value)} />
              <DateInput aria-label="Sampai tanggal" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          )}
          <div className="w-52">
            <Select aria-label="Akun arus kas" value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">Semua akun</option>
              {data?.balances.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
        </FilterRow>
        {invalid && (
          <p role="alert" className="text-down">
            Rentang tanggal tidak valid. Pilih tanggal akhir sesudah tanggal
            awal, maksimal 366 hari.
          </p>
        )}
        {result.isError && (
          <p role="alert" className="text-down">
            {result.error.message}{" "}
            <Button size="sm" onClick={() => void result.refetch()}>
              Coba lagi
            </Button>
          </p>
        )}
        {result.isPending && !invalid && (
          <p className="py-12 text-center text-muted">Memuat ringkasan…</p>
        )}
        {data && !invalid && (
          <>
            <div className="grid grid-cols-5 overflow-hidden rounded-xl border border-line max-[900px]:grid-cols-2">
              {(
                [
                  {
                    key: "sales",
                    title: "Penjualan",
                    value: data.current.sales,
                    note: `Faktur ${formatRupiah(data.current.invoiceSales)} · Kasir ${formatRupiah(data.current.posSales)}`,
                    share: data.current.sales
                      ? data.current.invoiceSales / data.current.sales
                      : 0,
                  },
                  {
                    key: "profit",
                    title: "Laba kotor",
                    value: data.current.profit,
                    note: `Margin ${data.current.margin.toLocaleString("id-ID")}% dari penjualan`,
                    share: data.current.margin / 100,
                  },
                  {
                    key: "net",
                    title: "Arus kas bersih",
                    value: data.current.net,
                    note: `Masuk ${formatRupiah(data.current.incoming)} · Keluar ${formatRupiah(data.current.outgoing)}`,
                    share: null,
                  },
                  {
                    key: "receivables",
                    title: "Piutang terbuka",
                    value: data.current.receivables,
                    note: `${formatRupiah(data.current.overdue)} telat`,
                    share: data.current.receivables
                      ? data.current.overdue / data.current.receivables
                      : 0,
                  },
                  {
                    key: "duePayables",
                    title: "Hutang jatuh tempo ≤7 hari",
                    value: data.current.duePayables,
                    note: "Termasuk hutang yang sudah telat",
                    share: null,
                  },
                ] as const
              ).map((kpi) => (
                <section className="border-l border-line p-4 first:border-l-0 max-[1200px]:p-3" key={kpi.key}>
                  <h2 className="text-ink-2">{kpi.title}</h2>
                  <p className="mt-1 text-[10px] text-muted">
                    {kpi.key === "receivables" || kpi.key === "duePayables"
                      ? `Per ${formatDate(window.to)}`
                      : range}
                  </p>
                  <div className={bigValue}>
                    <ShortMoney value={kpi.value} />
                  </div>
                  <p className="mb-2 text-[11px]">
                    <Delta
                      value={data.deltas[kpi.key]}
                      inverse={
                        kpi.key === "receivables" || kpi.key === "duePayables"
                      }
                    />{" "}
                    <span className="text-[10px] text-muted">vs periode sebelumnya</span>
                  </p>
                  <p
                    className={cx("min-h-8 text-[11px]", kpi.key === "receivables" ? "text-down" : "text-muted")}
                  >
                    {kpi.note}
                  </p>
                  {kpi.share !== null && (
                    <div
                      className={cx(
                        "mt-2.5 h-[3px] overflow-hidden rounded-[3px]",
                        kpi.key === "sales" ? "bg-faint" : "bg-line-2",
                      )}
                    >
                      <div
                        className="h-full"
                        style={{
                          width: `${Math.min(100, Math.max(0, kpi.share * 100))}%`,
                          background:
                            kpi.key === "receivables"
                              ? "var(--down)"
                              : "var(--ink)",
                        }}
                      />
                    </div>
                  )}
                </section>
              ))}
            </div>
            <p className="text-xs text-muted">
              Pembanding: {formatDate(data.previousWindow.from)}–
              {formatDate(data.previousWindow.to)}. Penjualan & faktur: seluruh
              toko. Arus kas: {selected}, tanpa transfer.
            </p>
            <div className="grid grid-cols-[minmax(0,1fr)_370px] gap-3.5 max-[1200px]:grid-cols-1">
              <section className={card}>
                <div className="flex items-start justify-between gap-2.5">
                  <div>
                    <h2>Arus kas</h2>
                    <p className="text-xs text-muted">
                      Uang masuk vs keluar · {selected} · mingguan
                    </p>
                  </div>
                  <div className="flex rounded-lg bg-bg p-0.5 whitespace-nowrap">
                    {(["12", "26"] as const).map((w) => (
                      <button
                        key={w}
                        className="cursor-pointer rounded-md px-2.5 py-1 text-muted aria-pressed:bg-panel aria-pressed:text-ink"
                        aria-pressed={weeks === w}
                        onClick={() => setWeeks(w)}
                      >
                        {w === "12" ? "12 minggu" : "6 bulan"}
                      </button>
                    ))}
                  </div>
                </div>
                <CashChart rows={data.chart} />
              </section>
              <div className="flex flex-col gap-3.5 min-[901px]:max-[1200px]:grid min-[901px]:max-[1200px]:grid-cols-2">
                <section className={card}>
                  <h2>Saldo per akun</h2>
                  <p className="text-xs text-muted">
                    Per {formatDate(data.today)} · seluruh akun
                  </p>
                  <div className={bigValue}>
                    <ShortMoney
                      value={data.balances.reduce((n, a) => n + a.balance, 0)}
                    />
                  </div>
                  <table className="mt-2.5 w-full text-[11px] tabular-nums [&_:is(th,td):nth-child(n+3)]:text-right [&_:is(th,td):nth-child(n+3)]:whitespace-nowrap [&_td]:border-t [&_td]:border-line-2 [&_td]:px-[3px] [&_td]:py-[9px] [&_th]:px-[3px] [&_th]:py-1.5 [&_th]:text-left [&_th]:font-normal [&_th]:text-muted">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Akun</th>
                        <th>Saldo</th>
                        <th>Minggu ini</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.balances.slice(0, 5).map((a, i) => (
                        <tr
                          key={a.id}
                          className={a.kind === "cash" ? "bg-line-2" : ""}
                        >
                          <td>{i + 1}</td>
                          <td>{a.name}</td>
                          <td title={formatRupiah(a.balance)}>
                            {formatRupiah(a.balance)}
                          </td>
                          <td
                            className={
                              a.weeklyChange > 0
                                ? "text-up"
                                : a.weeklyChange < 0
                                  ? "text-down"
                                  : "text-muted"
                            }
                          >
                            {a.weeklyChange > 0 ? "+" : ""}
                            {formatRupiah(a.weeklyChange)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Link className="mt-3 block text-right" to="/kas-bank">
                    Semua {data.balances.length} akun ›
                  </Link>
                </section>
                <section className={card}>
                  <div className="flex items-start justify-between gap-2.5">
                    <h2>Tindakan berikutnya</h2>
                    <Link className="text-xs text-muted" to="/tindakan">
                      {data.actionCount} tindakan ›
                    </Link>
                  </div>
                  {data.nextAction ? (
                    <div className="mt-3 flex flex-col items-start gap-2">
                      <ActionStatus item={data.nextAction} />
                      <p className="font-medium">{data.nextAction.name}</p>
                      <p className="text-xs text-muted">
                        {actionDescription(data.nextAction)}
                      </p>
                      <div className="mt-2 self-end">
                        <ActionLink item={data.nextAction} />
                      </div>
                    </div>
                  ) : (
                    <p className="mt-4 text-muted">
                      Semua sudah beres. Tidak ada tindakan saat ini.
                    </p>
                  )}
                </section>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <a
                className={linkButton.secondary}
                href={`/api/reports/cash-book.xlsx?${exportQuery}`}
              >
                Ekspor buku kas (.xlsx)
              </a>
              <a
                className={linkButton.secondary}
                href={`/api/reports/sales.xlsx?${new URLSearchParams({ ...window })}`}
              >
                Ekspor penjualan (.xlsx)
              </a>
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}
