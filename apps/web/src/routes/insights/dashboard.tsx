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
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Button } from "../../components/ui/button.tsx";
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "../../components/ui/chart.tsx";
import { DateInput, Select } from "../../components/ui/field.tsx";
import { FilterRow, PageBody, PageHeader } from "../../components/ui/page.tsx";
import { Tooltip } from "../../components/ui/tooltip.tsx";
import { YearlyOverview } from "./yearly-overview.tsx";
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
const cashChartConfig = {
  incoming: { label: "Masuk", color: "var(--ink)" },
  outgoing: { label: "Keluar", color: "var(--faint)" },
} satisfies ChartConfig;
const weekLabel = (from: unknown) => formatDate(String(from)).replace(/ \d{4}$/, "");
function CashChart({ rows }: { rows: Dashboard["chart"] }) {
  return (
    <ChartContainer config={cashChartConfig} className="mt-4 aspect-auto min-h-[260px] w-full flex-1 max-md:min-h-[240px]">
      <AreaChart data={rows} margin={{ left: 4, right: 8, top: 4 }}>
        <defs>
          {(["incoming", "outgoing"] as const).map((key) => (
            <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={`var(--color-${key})`} stopOpacity={0.3} />
              <stop offset="95%" stopColor={`var(--color-${key})`} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="from" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={weekLabel} />
        <YAxis tickLine={false} axisLine={false} width={88} tickFormatter={short} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(from) => `Minggu ${formatDate(String(from))}`}
              valueFormatter={(value) => formatRupiah(rupiah(Number(value)))}
            />
          }
        />
        <Area dataKey="outgoing" type="monotone" fill="url(#fill-outgoing)" stroke="var(--color-outgoing)" strokeWidth={1.8} />
        <Area dataKey="incoming" type="monotone" fill="url(#fill-incoming)" stroke="var(--color-incoming)" strokeWidth={2} />
        <ChartLegend itemSorter={null} content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
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
  const exportQuery = new URLSearchParams({
    ...window,
    ...(account ? { account } : {}),
  }).toString();
  return (
    <>
      <PageHeader
        title="Overview"
        actions={
          data && (
            <div className="flex items-baseline gap-x-2.5 rounded-full border border-line px-3.5 py-[7px] whitespace-nowrap text-muted max-md:gap-x-1.5 max-md:text-sm">
              Saldo kas & bank <b className="font-medium text-ink">{formatRupiah(data.totalBalance)}</b>
              <span>· {data.balances.length} akun</span>
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
          <Select className="w-36" aria-label="Periode" value={period} onChange={(e) => setPeriod(e.target.value as InsightPeriod)}>
            <option value="month">Bulan ini</option>
            <option value="last-month">Bulan lalu</option>
            <option value="30-days">30 hari</option>
            <option value="custom">Tanggal khusus</option>
          </Select>
          {period === "custom" && (
            <div className="flex w-80 gap-2">
              <DateInput aria-label="Dari tanggal" value={from} onChange={(e) => setFrom(e.target.value)} />
              <DateInput aria-label="Sampai tanggal" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          )}
          <Select className="w-52" aria-label="Akun arus kas" value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">Semua akun</option>
            {data?.balances.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
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
            <div className="grid grid-cols-5 gap-px overflow-hidden rounded-xl border border-line bg-line max-[900px]:grid-cols-2">
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
                <Tooltip
                  key={kpi.key}
                  className="bg-panel p-4 max-[1200px]:p-3 max-[900px]:last:col-span-2"
                  content={
                    <div className="flex flex-col gap-1">
                      <span>
                        <Delta value={data.deltas[kpi.key]} inverse={kpi.key === "receivables" || kpi.key === "duePayables"} />{" "}
                        <span className="text-muted">vs periode sebelumnya</span>
                      </span>
                      <span className={kpi.key === "receivables" ? "text-down" : "text-ink-2"}>{kpi.note}</span>
                    </div>
                  }
                >
                  <section aria-label={kpi.title}>
                    <h2 className="text-ink-2">{kpi.title}</h2>
                    <div className={bigValue}>
                      <ShortMoney value={kpi.value} />
                    </div>
                    <p className="sr-only">{kpi.note}</p>
                    {kpi.share !== null && (
                      <div className={cx("mt-3 h-[3px] overflow-hidden rounded-[3px]", kpi.key === "sales" ? "bg-faint" : "bg-line-2")}>
                        <div
                          className="h-full"
                          style={{
                            width: `${Math.min(100, Math.max(0, kpi.share * 100))}%`,
                            background: kpi.key === "receivables" ? "var(--down)" : "var(--ink)",
                          }}
                        />
                      </div>
                    )}
                  </section>
                </Tooltip>
              ))}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_370px] gap-3.5 max-[1200px]:grid-cols-1">
              <section className={cx(card, "flex flex-col")}>
                <div className="flex items-start justify-between gap-2.5">
                  <h2>Arus kas</h2>
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
                  <div className={bigValue}>
                    <ShortMoney
                      value={data.balances.reduce((n, a) => n + a.balance, 0)}
                    />
                  </div>
                  <table className="mt-2.5 w-full text-xs tabular-nums [&_:is(th,td):nth-child(n+3)]:text-right [&_:is(th,td):nth-child(n+3)]:whitespace-nowrap [&_td]:border-t [&_td]:border-line-2 [&_td]:px-[3px] [&_td]:py-[9px] [&_th]:px-[3px] [&_th]:py-1.5 [&_th]:text-left [&_th]:font-normal [&_th]:text-muted">
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
            <YearlyOverview />
            <div className="flex flex-wrap justify-end gap-2">
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
