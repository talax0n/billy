import { type ApprovalKind, DomainError, fieldErrors } from "@billy/core";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { ApprovalRequired } from "./approval.ts";

/** Body of every non-2xx response. `fields` maps an input path to its message. */
export interface ErrorBody {
  error: string;
  fields?: Record<string, string>;
  /** Present on a 403 that an admin's approval would lift. */
  approval?: { kind: ApprovalKind | null };
}

const domainStatus = { invalid: 422, conflict: 409, not_found: 404, forbidden: 403 } as const;

/** Never leaks stack traces or SQL: unknown errors are logged and answered with a generic 500. */
export function onError(err: Error, c: Context): Response {
  if (err instanceof z.core.$ZodError) {
    return c.json<ErrorBody>({ error: "Periksa kembali isian", fields: fieldErrors(err) }, 400);
  }
  if (err instanceof ApprovalRequired) {
    return c.json<ErrorBody>({ error: err.message, approval: { kind: err.approvalKind } }, 403);
  }
  if (err instanceof DomainError) {
    return c.json<ErrorBody>({ error: err.message }, domainStatus[err.kind]);
  }
  if (err instanceof HTTPException) {
    return c.json<ErrorBody>({ error: err.message }, err.status);
  }
  const pg = postgresError(err);
  if (pg?.code === "23505") {
    const field = uniqueField(pg);
    return c.json<ErrorBody>({ error: "Nilai sudah dipakai data lain", ...(field && { fields: { [field]: "Sudah dipakai" } }) }, 409);
  }
  if (pg?.code === "23503") {
    return c.json<ErrorBody>({ error: "Data terkait tidak ditemukan atau masih dipakai" }, 409);
  }
  console.error(err);
  return c.json<ErrorBody>({ error: "Terjadi kesalahan di server" }, 500);
}

interface PostgresError {
  code: string;
  table?: string;
  constraint?: string;
}

/** Drizzle wraps driver errors; the Postgres error with its SQLSTATE code sits in the cause chain. */
function postgresError(err: unknown): PostgresError | undefined {
  for (let e = err; e instanceof Error; e = e.cause) {
    if (typeof (e as Partial<PostgresError>).code === "string") return e as unknown as PostgresError;
  }
  return undefined;
}

/** Drizzle names unique constraints `{table}_{column}_unique`: `products_barcode_unique` → `barcode`. */
function uniqueField({ table, constraint }: PostgresError): string | undefined {
  if (!table || !constraint?.startsWith(`${table}_`) || !constraint.endsWith("_unique")) return undefined;
  const column = constraint.slice(table.length + 1, -"_unique".length);
  return column.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}
