import { queryOptions } from "@tanstack/react-query";
import { api, unwrap } from "./api.ts";

export const settingsQuery = queryOptions({
  queryKey: ["settings"],
  queryFn: () => unwrap(api.settings.$get()),
  staleTime: 5 * 60_000,
});
