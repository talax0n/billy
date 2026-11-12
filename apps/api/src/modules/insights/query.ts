import { businessDateInput, paginationQuery } from "@billy/core";
import { z } from "zod";
export const reportQuery = z
  .object({
    from: businessDateInput,
    to: businessDateInput,
    account: z.uuid().optional(),
  })
  .refine((q) => q.from <= q.to, {
    message: "Tanggal akhir harus sesudah tanggal awal",
    path: ["to"],
  })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 366 * 86400000, {
    message: "Maksimal 366 hari",
    path: ["to"],
  });
export const dashboardQuery = reportQuery.safeExtend({
  weeks: z.enum(["12", "26"]).default("12"),
});
export const actionsQuery = paginationQuery;
