import { type BusinessDate, type DocPrefix, docPeriod, formatDocNumber } from "@billy/core";
import { type Db, documentSequences } from "@billy/db";
import { sql } from "drizzle-orm";

/**
 * Next `{PREFIX}-{YYMMDD}-{NNNN}` for a server-numbered document. Call it inside the
 * command's transaction: the upsert's row lock serialises concurrent callers, and a
 * rolled-back command gives its number back.
 */
export async function allocateDocNumber(tx: Db, prefix: DocPrefix, date: BusinessDate): Promise<string> {
  const [row] = await tx
    .insert(documentSequences)
    .values({ prefix, period: docPeriod(date), lastValue: 1 })
    .onConflictDoUpdate({
      target: [documentSequences.prefix, documentSequences.period],
      set: { lastValue: sql`${documentSequences.lastValue} + 1` },
    })
    .returning({ value: documentSequences.lastValue });
  return formatDocNumber(prefix, date, row!.value);
}
