/**
 * shadcn/ui chart (https://ui.shadcn.com/charts), adapted to this app's tokens.
 * Series colours come from `config[key].color`, exposed as `--color-<key>` on the container;
 * pass token variables (`var(--ink)`) so light and dark follow `[data-theme]` without a theme map.
 */
import { createContext, type ComponentProps, type ComponentType, type ReactNode, useContext, useId } from "react";
import * as Recharts from "recharts";
import { cx } from "../../lib/cx.ts";

export type ChartConfig = Record<string, { label?: ReactNode; icon?: ComponentType; color?: string }>;

const ChartContext = createContext<ChartConfig | null>(null);

function useChart() {
  const config = useContext(ChartContext);
  if (!config) throw new Error("useChart must be used within a <ChartContainer />");
  return config;
}

export function ChartContainer({
  id,
  className,
  children,
  config,
  style,
  ...props
}: ComponentProps<"div"> & {
  config: ChartConfig;
  children: ComponentProps<typeof Recharts.ResponsiveContainer>["children"];
}) {
  const uniqueId = useId();
  const colors = Object.fromEntries(
    Object.entries(config).flatMap(([key, item]) => (item.color ? [[`--color-${key}`, item.color]] : [])),
  );
  return (
    <ChartContext.Provider value={config}>
      <div
        data-slot="chart"
        data-chart={`chart-${id ?? uniqueId.replace(/:/g, "")}`}
        style={{ ...colors, ...style }}
        className={cx(
          "flex aspect-video justify-center text-xs",
          "[&_.recharts-cartesian-axis-tick_text]:fill-muted [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-line-2",
          "[&_.recharts-curve.recharts-tooltip-cursor]:stroke-line [&_.recharts-dot[stroke='#fff']]:stroke-transparent",
          "[&_.recharts-layer]:outline-hidden [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-line-2",
          "[&_.recharts-reference-line_[stroke='#ccc']]:stroke-line [&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <Recharts.ResponsiveContainer initialDimension={{ width: 320, height: 200 }}>{children}</Recharts.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

export const ChartTooltip = Recharts.Tooltip;

interface TooltipItem {
  name?: unknown;
  dataKey?: unknown;
  value?: unknown;
  color?: string | undefined;
  type?: string | undefined;
  payload?: unknown;
}

/** Tooltip body: optional label, then one row per series with a colour dot, name and value. */
export function ChartTooltipContent({
  active,
  payload,
  label,
  className,
  hideLabel = false,
  labelFormatter,
  valueFormatter = (value) => (typeof value === "number" ? value.toLocaleString("id-ID") : String(value)),
}: {
  active?: boolean;
  payload?: readonly TooltipItem[];
  label?: unknown;
  className?: string;
  hideLabel?: boolean;
  labelFormatter?: (label: unknown) => ReactNode;
  valueFormatter?: (value: unknown) => ReactNode;
}) {
  const config = useChart();
  if (!active || !payload?.length) return null;
  return (
    <div className={cx("grid min-w-32 gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs shadow-xl", className)}>
      {!hideLabel && label != null && <div className="font-medium">{labelFormatter ? labelFormatter(label) : String(label)}</div>}
      {payload
        .filter((item) => item.type !== "none")
        .map((item, index) => {
          const key = String(item.dataKey ?? item.name ?? "value");
          const itemConfig = config[key];
          return (
            <div key={index} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: item.color }} />
              <span className="flex-1 text-muted">{itemConfig?.label ?? String(item.name)}</span>
              {item.value != null && <span className="font-medium text-ink tabular-nums">{valueFormatter(item.value)}</span>}
            </div>
          );
        })}
    </div>
  );
}

export const ChartLegend = Recharts.Legend;

export function ChartLegendContent({
  className,
  payload,
  verticalAlign = "bottom",
}: {
  className?: string;
  payload?: readonly { dataKey?: unknown; value?: unknown; color?: string | undefined; type?: string | undefined }[];
  verticalAlign?: "top" | "middle" | "bottom";
}) {
  const config = useChart();
  if (!payload?.length) return null;
  return (
    <div className={cx("flex items-center justify-center gap-4", verticalAlign === "top" ? "pb-3" : "pt-3", className)}>
      {payload
        .filter((item) => item.type !== "none")
        .map((item, index) => {
          const itemConfig = config[String(item.dataKey ?? "value")];
          return (
            <div key={index} className="flex items-center gap-1.5 text-muted">
              <span className="size-2 shrink-0 rounded-[2px]" style={{ background: item.color }} />
              {itemConfig?.label ?? String(item.value)}
            </div>
          );
        })}
    </div>
  );
}
