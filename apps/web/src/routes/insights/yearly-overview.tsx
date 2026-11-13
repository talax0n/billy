import { formatRupiah, rupiah } from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "../../components/ui/chart.tsx";
import { api, unwrap } from "../../lib/api.ts";

const series = {
  sales: { label: "Penjualan", color: "var(--chart-1)" },
  purchases: { label: "Pembelian", color: "var(--chart-2)" },
  expenses: { label: "Biaya", color: "var(--chart-3)" },
  pos: { label: "Kasir", color: "var(--chart-4)" },
} satisfies ChartConfig;
type Series = keyof typeof series;

const monthName = (month: string, style: "short" | "long") =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("id-ID", { month: style, year: style === "long" ? "numeric" : undefined, timeZone: "UTC" });
const compact = (n: number) => formatRupiah(rupiah(n), { compact: true });

/** The legacy dashboard's one-year view: totals per kind and a grouped bar per month. */
export function YearlyOverview() {
  const { data } = useQuery({
    queryKey: ["insights", "yearly"],
    queryFn: () => unwrap(api.insights.yearly.$get()),
    refetchInterval: 60000,
  });
  if (!data) return null;
  return (
    <section className="grid grid-cols-[260px_minmax(0,1fr)] gap-5 rounded-xl border border-line px-5 py-[18px] max-[1000px]:grid-cols-1">
      <div className="flex flex-col gap-3">
        <h2 className="font-medium">12 bulan terakhir</h2>
        <div className="grid grid-cols-1 gap-2.5 max-[1000px]:grid-cols-4 max-md:grid-cols-2">
          {(Object.keys(series) as Series[]).map((key) => (
            <div key={key} className="rounded-lg border border-line px-3.5 py-3">
              <div className="flex items-center gap-2 text-ink-2">
                <span className="size-2.5 rounded-[3px]" style={{ background: series[key].color }} />
                {series[key].label}
              </div>
              <div className="mt-1.5 text-xl font-medium tracking-tight tabular-nums" title={formatRupiah(data.totals[key])}>
                {compact(data.totals[key])}
              </div>
            </div>
          ))}
        </div>
      </div>
      <ChartContainer config={series} className="aspect-auto min-h-[320px] w-full">
        <BarChart data={data.months} margin={{ left: 4, right: 8, top: 8 }} barGap={2}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(m: string) => monthName(m, "short")} />
          <YAxis tickLine={false} axisLine={false} width={88} tickFormatter={compact} />
          <ChartTooltip
            cursor={{ fill: "var(--line-2)" }}
            content={
              <ChartTooltipContent
                labelFormatter={(m) => monthName(String(m), "long")}
                valueFormatter={(v) => formatRupiah(rupiah(Number(v)))}
              />
            }
          />
          <ChartLegend itemSorter={null} content={<ChartLegendContent />} />
          {(Object.keys(series) as Series[]).map((key) => (
            <Bar key={key} dataKey={key} fill={`var(--color-${key})`} radius={[3, 3, 0, 0]} maxBarSize={14} />
          ))}
        </BarChart>
      </ChartContainer>
    </section>
  );
}
