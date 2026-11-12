import { addDays, type BusinessDate, businessDate, formatDate } from "@billy/core";
import { DateInput, Select } from "../../components/ui/field.tsx";

export const periodPresets = {
  month: "Bulan ini",
  lastMonth: "Bulan lalu",
  last30: "30 hari terakhir",
  year: "Tahun ini",
  all: "Semua tanggal",
  custom: "Pilih tanggal",
} as const;

export interface Period {
  preset: keyof typeof periodPresets;
  /** Empty means open-ended. */
  from: BusinessDate | "";
  to: BusinessDate | "";
}

export function presetPeriod(preset: Period["preset"], today: BusinessDate = businessDate()): Period {
  const monthStart = `${today.slice(0, 8)}01`;
  switch (preset) {
    case "month":
      return { preset, from: monthStart, to: today };
    case "lastMonth": {
      const lastMonthEnd = addDays(monthStart, -1);
      return { preset, from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd };
    }
    case "last30":
      return { preset, from: addDays(today, -29), to: today };
    case "year":
      return { preset, from: `${today.slice(0, 4)}-01-01`, to: today };
    case "all":
    case "custom":
      return { preset, from: "", to: "" };
  }
}

/** The window a summary covers, in words: "1 Nov 2026 – 13 Nov 2026". */
export function periodLabel({ from, to }: Period): string {
  if (!from && !to) return "Semua tanggal";
  if (!to) return `Sejak ${formatDate(from)}`;
  if (!from) return `Sampai ${formatDate(to)}`;
  return from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
}

/** `{ from, to }` query params for a list endpoint, leaving out the open ends. */
export const periodQuery = ({ from, to }: Period) => ({ ...(from && { from }), ...(to && { to }) });

export function PeriodFilter({ value, onChange }: { value: Period; onChange: (period: Period) => void }) {
  return (
    <>
      <div className="w-44">
        <Select
          aria-label="Periode"
          value={value.preset}
          onChange={(e) => {
            const preset = e.target.value as Period["preset"];
            onChange(preset === "custom" ? { ...value, preset } : presetPeriod(preset));
          }}
        >
          {Object.entries(periodPresets).map(([preset, label]) => (
            <option key={preset} value={preset}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      {value.preset === "custom" && (
        <div className="flex items-center gap-2">
          <DateInput aria-label="Dari tanggal" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          <span className="text-muted">–</span>
          <DateInput aria-label="Sampai tanggal" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} />
        </div>
      )}
    </>
  );
}
