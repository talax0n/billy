import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../../lib/api.ts";

/** After a payment or void: every list, total and stock figure that can change. */
export function useRefreshAfterPosting() {
  const queryClient = useQueryClient();
  return () => Promise.all(["purchases", "products", "stock"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
}

/**
 * Toasts render beneath an open `<dialog>`, so a form inside a dialog or sheet also shows the
 * server's refusal inline. `guard` records the message and rethrows for `useForm`.
 */
export function useServerError() {
  const [message, setMessage] = useState<string | null>(null);
  async function guard<T>(request: Promise<T>): Promise<T> {
    setMessage(null);
    try {
      return await request;
    } catch (err) {
      if (err instanceof ApiError) setMessage(err.message);
      throw err;
    }
  }
  return { message, guard };
}
