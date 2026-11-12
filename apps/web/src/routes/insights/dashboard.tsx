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
import { FilterRow, PageBody, PageHeader } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { ActionLink, ActionStatus, actionDescription } from "./actions.tsx";
import "./insights.css";

type Dashboard = InferResponseType<typeof api.insights.dashboard.$get, 200>;
const compact = (n: number) =>
  Math.abs(n) >= 1e9
    ? { value: n / 1e9, unit: "M" }
    : Math.abs(n) >= 1e6
      ? { value: n / 1e6, unit: "jt" }
      : { value: n, unit: "" };
function ShortMoney({ value }: { value: number }) {
  const short = compact(value);
  const [integer, fraction] = short.value
    .toLocaleString("id-ID", { maximumFractionDigits: short.unit ? 1 : 0 })
    .split(",");
  return (
    <span title={formatRupiah(rupiah(value))}>
      Rp {integer}
      <span className="text-faint">
        {fraction && `,${fraction}`} {short.unit}
      </span>
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
function CashChart({ rows }: { rows: Dashboard["chart"] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.incoming, r.outgoing]));
  const x = (i: number) => 48 + (i * 472) / (rows.length - 1);
  const y = (value: number) => 290 - (value / max) * 240;
  const path = (key: "incoming" | "outgoing") =>
    rows.map((r, i) => `${i ? "L" : "M"}${x(i)},${y(r[key])}`).join(" ");
  const last = rows.at(-1)!;
  const incomingY = y(last.incoming),
    outgoingY =
      Math.abs(y(last.outgoing) - incomingY) < 24
        ? incomingY + 25
        : y(last.outgoing);
  const label = (n: number) => {
    const s = compact(n);
    return `${s.value.toLocaleString("id-ID", { maximumFractionDigits: 1 })} ${s.unit}`;
  };
  return (
    <svg
      className="insight-chart"
      viewBox="0 0 660 330"
      role="img"
      aria-label="Arus kas mingguan: uang masuk dan keluar, tanpa transfer"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line
            x1="48"
            x2="520"
            y1={50 + i * 60}
            y2={50 + i * 60}
            stroke="var(--line-2)"
          />
          <text x="0" y={54 + i * 60}>
            {label((max * (4 - i)) / 4)}
          </text>
        </g>
      ))}
      <path
        d={path("incoming")}
        fill="none"
        stroke="var(--ink)"
        strokeWidth="2.2"
      />
      <path
        d={path("outgoing")}
        fill="none"
        stroke="var(--faint)"
        strokeWidth="1.8"
      />
      {rows.map((r, i) => (
        <g key={r.from}>
          <circle cx={x(i)} cy={y(r.incoming)} r="3" fill="var(--ink)">
            <title>
              {formatDate(r.from)} · Masuk {formatRupiah(r.incoming)}
            </title>
          </circle>
          <circle cx={x(i)} cy={y(r.outgoing)} r="3" fill="var(--faint)">
            <title>
              {formatDate(r.from)} · Keluar {formatRupiah(r.outgoing)}
            </title>
          </circle>
          {(i % Math.ceil(rows.length / 5) === 0 || i === rows.length - 1) && (
            <text x={x(i)} y="318" textAnchor="middle">
              {formatDate(r.from).replace(/ \d{4}$/, "")}
            </text>
          )}
        </g>
      ))}
      <rect
        x="531"
        y={incomingY - 13}
        width="125"
        height="24"
        rx="12"
        fill="var(--ink)"
      />
      <text x="541" y={incomingY + 3} style={{ fill: "var(--panel)" }}>
        Masuk {label(last.incoming)}
      </text>
      <text x="541" y={outgoingY + 3}>
        Keluar {label(last.outgoing)}
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
            <div className="insight-pill">
              Saldo kas & bank <b>{formatRupiah(data.totalBalance)}</b>
              <span>
                · {data.balances.filter((a) => a.kind !== "ewallet").length}{" "}
                akun
              </span>
            </div>
          )
        }
      />
      <PageBody className="insights">
        <FilterRow
          aside={
            data
              ? `Data per ${new Date(data.asOf).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })} WIB`
              : "Memuat data…"
          }
        >
          <select
            aria-label="Periode"
            value={period}
            onChange={(e) => setPeriod(e.target.value as InsightPeriod)}
          >
            <option value="month">Bulan ini</option>
            <option value="last-month">Bulan lalu</option>
            <option value="30-days">30 hari</option>
            <option value="custom">Tanggal khusus</option>
          </select>
          {period === "custom" && (
            <>
              <input
                aria-label="Dari tanggal"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <input
                aria-label="Sampai tanggal"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </>
          )}
          <select
            aria-label="Akun arus kas"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="">Semua akun</option>
            {data?.balances.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
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
            <button onClick={() => void result.refetch()}>Coba lagi</button>
          </p>
        )}
        {result.isPending && !invalid && (
          <p className="py-12 text-center text-muted">Memuat ringkasan…</p>
        )}
        {data && !invalid && (
          <>
            <div className="insight-kpis">
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
                <section className="insight-kpi" key={kpi.key}>
                  <h2>{kpi.title}</h2>
                  <p className="insight-window">
                    {kpi.key === "receivables" || kpi.key === "duePayables"
                      ? `Per ${formatDate(window.to)}`
                      : range}
                  </p>
                  <div className="insight-value">
                    <ShortMoney value={kpi.value} />
                  </div>
                  <p className="insight-delta">
                    <Delta
                      value={data.deltas[kpi.key]}
                      inverse={
                        kpi.key === "receivables" || kpi.key === "duePayables"
                      }
                    />{" "}
                    <span>vs periode sebelumnya</span>
                  </p>
                  <p
                    className={`insight-note ${kpi.key === "receivables" ? "text-down" : "text-muted"}`}
                  >
                    {kpi.note}
                  </p>
                  {kpi.share !== null && (
                    <div
                      className={`insight-bar ${kpi.key === "sales" ? "insight-split" : ""}`}
                    >
                      <i
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
            <div className="insight-grid">
              <section className="insight-card insight-chart-card">
                <div className="insight-card-head">
                  <div>
                    <h2>Arus kas</h2>
                    <p className="text-xs text-muted">
                      Uang masuk vs keluar · {selected} · mingguan
                    </p>
                  </div>
                  <div className="insight-segments">
                    {(["12", "26"] as const).map((w) => (
                      <button
                        key={w}
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
              <div className="insight-right">
                <section className="insight-card">
                  <h2>Saldo per akun</h2>
                  <p className="text-xs text-muted">
                    Per {formatDate(data.today)} · seluruh akun
                  </p>
                  <div className="insight-value">
                    <ShortMoney
                      value={data.balances.reduce((n, a) => n + a.balance, 0)}
                    />
                  </div>
                  <table className="insight-balances">
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
                <section className="insight-card">
                  <div className="insight-card-head">
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
                className="insight-button secondary"
                href={`/api/reports/cash-book.xlsx?${exportQuery}`}
              >
                Ekspor buku kas (.xlsx)
              </a>
              <a
                className="insight-button secondary"
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
