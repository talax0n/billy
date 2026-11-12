import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { api, unwrap } from "../../lib/api.ts";

export type InvoiceRow = InferResponseType<typeof api.sales.$get, 200>["rows"][number];
export type InvoiceDetail = InferResponseType<(typeof api.sales)[":id"]["$get"], 200>;

export const invoiceQuery = (id: string) =>
  queryOptions({ queryKey: ["sales", id], queryFn: () => unwrap(api.sales[":id"].$get({ param: { id } })) });
