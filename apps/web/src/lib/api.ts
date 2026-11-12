import type { AppType } from "@billy/api";
import { hc, type ClientResponse } from "hono/client";

/** Typed client for every API route: `api.products.$get({ query })`. */
export const api = hc<AppType>("/").api;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Input path → message, as sent by the API for 400 and 409 responses. */
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

/** Awaits a client call and returns its JSON body, or throws `ApiError` with the server's message. */
export async function unwrap<T>(request: Promise<ClientResponse<T, number, "json">>): Promise<T> {
  let res: ClientResponse<T, number, "json">;
  try {
    res = await request;
  } catch {
    throw new ApiError("Tidak tersambung ke server", 0);
  }
  if (res.ok) return res.json();
  const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
  throw new ApiError(body.error ?? `Gagal (${res.status})`, res.status, body.fields);
}
