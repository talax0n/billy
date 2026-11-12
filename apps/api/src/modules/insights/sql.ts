import { rupiah, type Rupiah } from "@billy/core";
import { cashEntries } from "@billy/db";
import { sql, type SQL } from "drizzle-orm";

/** A summed bigint column as whole rupiah; an empty sum is 0. */
export const money = (expr: SQL) =>
  sql<Rupiah>`coalesce(${expr}, 0)`.mapWith((v) => rupiah(Number(v)));

export const signedAmount = sql`case when ${cashEntries.direction} = 'in' then ${cashEntries.amount} else -${cashEntries.amount} end`;

/** Every read of one report sees the same ledger state. */
export const snapshot = { isolationLevel: "repeatable read" } as const;
