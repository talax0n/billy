import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { InferResponseType } from "hono/client";
import { api, ApiError, unwrap } from "./api.ts";

export type Me = InferResponseType<typeof api.auth.me.$get, 200>;

/** The signed-in user, or null. Loaded by the router guard, then read from the cache. */
export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: async (): Promise<Me | null> => {
    try {
      return await unwrap(api.auth.me.$get());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  },
  staleTime: Number.POSITIVE_INFINITY,
});

/** Ends the session, drops every cached query and returns to the login page. */
export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await api.auth.logout.$post().catch(() => undefined);
    queryClient.clear();
    queryClient.setQueryData(meQuery.queryKey, null);
    await navigate({ to: "/login" });
  };
}
