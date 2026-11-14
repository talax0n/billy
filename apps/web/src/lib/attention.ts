import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { api, unwrap } from "./api.ts";

export type Attention = InferResponseType<typeof api.insights.attention.$get, 200>;

/** One request behind the login notice and the sidebar badges. */
export const attentionQuery = queryOptions({
  queryKey: ["insights", "attention"],
  queryFn: () => unwrap(api.insights.attention.$get()),
  refetchInterval: 60_000,
});
