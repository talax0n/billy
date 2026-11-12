import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { InferResponseType } from "hono/client";
import { api, ApiError, unwrap } from "./api.ts";

export type Me = InferResponseType<typeof api.auth.me.$get, 200>;

const LAST_ME = "last-me";

/**
 * The signed-in user, or null. Loaded by the router guard, then read from the cache.
 * When the server cannot be reached the last known user is used, so the POS opens offline;
 * the API still checks the session on every request.
 */
export const meQuery = queryOptions({
  queryKey: ["me"],
  networkMode: "always",
  queryFn: async (): Promise<Me | null> => {
    try {
      const me = await unwrap(api.auth.me.$get());
      localStorage.setItem(LAST_ME, JSON.stringify(me));
      return me;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      const last = localStorage.getItem(LAST_ME);
      if (err instanceof ApiError && (err.status === 0 || err.status >= 500) && last) return JSON.parse(last) as Me;
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
    localStorage.removeItem(LAST_ME);
    queryClient.clear();
    queryClient.setQueryData(meQuery.queryKey, null);
    await navigate({ to: "/login" });
  };
}
