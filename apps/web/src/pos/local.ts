import { businessDate, nextPosNumber, parsePosNumber, type PosSaleInput } from "@billy/core";
import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { createStore, get, set, update } from "idb-keyval";
import { api, unwrap } from "../lib/api.ts";
import type { Cart } from "./cart.ts";
import type { ReceiptData } from "./receipt.tsx";

export type Catalog = InferResponseType<typeof api.pos.catalog.$get, 200>;
export type CatalogProduct = Catalog["products"][number];

/** A sale waiting for upload, with the receipt it printed so it can be reprinted offline. */
export interface QueuedSale {
  sale: PosSaleInput;
  receipt: ReceiptData;
}

/** A sale the server refused (4xx). Kept until someone retries or removes it. */
export interface SyncProblem extends QueuedSale {
  error: string;
  status: number;
}

export interface ParkedCart {
  id: string;
  parkedAt: string;
  cart: Cart;
}

interface Counter {
  deviceCode: string;
  period: string;
  value: number;
}

/**
 * Everything the cashier keeps on the device, in one IndexedDB object store. Each key is
 * read and written whole; `update` runs in a single transaction, so appends never race.
 */
interface Schema {
  catalog: Catalog;
  outbox: QueuedSale[];
  problems: SyncProblem[];
  counter: Counter;
  parked: ParkedCart[];
  lastReceipt: ReceiptData;
}

const store = createStore("billy-pos", "kv");

export const read = <K extends keyof Schema>(key: K) => get<Schema[K]>(key, store);
export const write = <K extends keyof Schema>(key: K, value: Schema[K]) => set(key, value, store);
export const change = <K extends keyof Schema>(key: K, fn: (value: Schema[K] | undefined) => Schema[K]) =>
  update<Schema[K]>(key, fn, store);

function nextNumber(deviceCode: string, serverLast: string | null, local: Counter | undefined) {
  const fromServer = serverLast ? parsePosNumber(serverLast) : null;
  const candidates = [local?.deviceCode === deviceCode ? local : null, fromServer?.deviceCode === deviceCode ? fromServer : null];
  const last = candidates.reduce<{ period: string; value: number } | null>(
    (best, c) => (c && (!best || c.period > best.period || (c.period === best.period && c.value > best.value)) ? c : best),
    null,
  );
  return nextPosNumber(deviceCode, businessDate(), last);
}

/** The number the next sale will get, for the top bar. */
export async function peekNumber(deviceCode: string, serverLast: string | null): Promise<string> {
  return nextNumber(deviceCode, serverLast, await read("counter")).number;
}

/**
 * Allocates the next receipt number of this device (`K1-261113-0042`). The counter lives on
 * the device so a receipt prints offline; `serverLast` (from the catalog) lets a device whose
 * storage was wiped continue after the numbers the server already holds.
 */
export async function allocateNumber(deviceCode: string, serverLast: string | null): Promise<string> {
  let number = "";
  await change("counter", (local) => {
    const next = nextNumber(deviceCode, serverLast, local);
    number = next.number;
    return { deviceCode, period: next.period, value: next.value };
  });
  return number;
}

/**
 * The catalog, fresh from the server when it answers and from the device otherwise. Any
 * failure, including an expired session, falls back to the cache: selling never stops.
 */
export const catalogQuery = queryOptions({
  queryKey: ["pos", "catalog"],
  networkMode: "always",
  staleTime: Number.POSITIVE_INFINITY,
  queryFn: async (): Promise<Catalog> => {
    try {
      const fresh = await unwrap(api.pos.catalog.$get());
      await write("catalog", fresh);
      return fresh;
    } catch (err) {
      const cached = await read("catalog");
      if (cached) return cached;
      throw err;
    }
  },
});
