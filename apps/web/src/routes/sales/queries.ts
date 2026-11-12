import { addDays, businessDate, formatDate } from "@billy/core";
import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { api, unwrap } from "../../lib/api.ts";

export type InvoiceRow = InferResponseType<typeof api.sales.$get, 200>["rows"][number];
export type InvoiceDetail = InferResponseType<(typeof api.sales)[":id"]["$get"], 200>;

export const invoiceQuery = (id: string) =>
  queryOptions({ queryKey: ["sales", id], queryFn: () => unwrap(api.sales[":id"].$get({ param: { id } })) });

export const periods = {
  month: "Bulan ini",
  lastMonth: "Bulan lalu",
  days30: "30 hari terakhir",
  year: "Tahun ini",
  all: "Semua waktu",
} as const;
export type Period = keyof typeof periods;

/** Inclusive business-date range of a period preset; `all` has no bounds. */
export function periodRange(period: Period, today = businessDate()): { from?: string; to?: string } {
  const monthStart = `${today.slice(0, 8)}01`;
  switch (period) {
    case "month":
      return { from: monthStart, to: today };
    case "lastMonth": {
      const end = addDays(monthStart, -1);
      return { from: `${end.slice(0, 8)}01`, to: end };
    }
    case "days30":
      return { from: addDays(today, -29), to: today };
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "all":
      return {};
  }
}

/** The window a tile summarises, spelled out: "Faktur 1 Nov 2026 – 13 Nov 2026". */
export function periodLabel(period: Period): string {
  const { from, to } = periodRange(period);
  return from && to ? `Faktur ${formatDate(from)} – ${formatDate(to)}` : "Faktur semua tanggal";
}
