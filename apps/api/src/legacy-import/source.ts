/** Reads the legacy export in .legacy/ the same way for every import script, so document order and receipt numbers match. */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isoDate, normName, posNumber } from "./parse.ts";

export type Row = string[];
export interface Page {
  inputs: Record<string, string>;
  rows: Row[];
}
export interface Detail {
  id: string;
  row: Row;
  pages: Record<string, Page>;
}

export const root = fileURLToPath(new URL("../../../../", import.meta.url));
export const src = `${root}.legacy/`;
export const errorsFile = `${src}import-errors.jsonl`;

export const list = (name: string): Row[] => JSON.parse(readFileSync(`${src}lists/${name}.json`, "utf8"));
export const details = (name: string): Detail[] => {
  const file = `${src}details/${name}.jsonl`;
  if (!existsSync(file)) return [];
  const byId = new Map<string, Detail>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    try {
      const d = JSON.parse(line) as Detail;
      byId.set(d.id, d);
    } catch {
      // partial line from an interrupted download
    }
  }
  return [...byId.values()];
};

export const oldestFirst = <T extends { date: string }>(docs: T[]) => docs.sort((a, b) => a.date.localeCompare(b.date));

/**
 * Cashier receipts oldest first, each with the receipt number the import gives it. Legacy
 * numbers repeat now and then; a repeat gets two extra digits so both receipts are kept.
 * `number` is null for an unreadable legacy number (the import rejects that receipt).
 */
export function numberedReceipts() {
  const used = new Set<string>();
  return oldestFirst(details("kasir").map((d) => ({ ...d, date: isoDate(d.row[2]!) }))).map((d) => {
    let base: string;
    try {
      base = posNumber(d.row[1]!);
    } catch {
      return { ...d, number: null };
    }
    let number = base;
    for (let n = 1; used.has(number); n++) number = `${base}${String(n).padStart(2, "0")}`;
    used.add(number);
    return { ...d, number };
  });
}

/** Which account each receipt's money went to, from the ledger's "kasir" rows: receipt ref → account name. */
export const posAccounts = (jurnal: Row[]) =>
  new Map(jurnal.filter((r) => r[2] === "kasir" && r[1]).map((r) => [r[1]!.trim(), normName(r[3] ?? "")]));
export const posMethod = (accountName: string) => (accountName === "KAS" ? "cash" : accountName === "QR" ? "qris" : "transfer");
