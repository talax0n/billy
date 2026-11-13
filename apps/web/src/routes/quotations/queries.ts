import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { api, unwrap } from "../../lib/api.ts";

export type QuotationDetail = InferResponseType<(typeof api.quotations)[":id"]["$get"], 200>;

export const quotationQuery = (id: string) =>
  queryOptions({ queryKey: ["quotations", id], queryFn: () => unwrap(api.quotations[":id"].$get({ param: { id } })) });
