import {
  businessDate,
  nextPosNumber,
  type OutboxLists,
  type OutboxProblem,
  parsePosNumber,
  type PosSaleInput,
} from "@billy/core";
import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { createStore, get, promisifyRequest, set, update } from "idb-keyval";
import { api, unwrap } from "../lib/api.ts";
import type { Cart } from "./cart.ts";
import type { ReceiptData } from "./receipt.tsx";

export type Catalog = InferResponseType<typeof api.pos.catalog.$get, 200>;
export type CatalogProduct = Catalog["products"][number];
export type CatalogCustomer = Catalog["customers"][number];

/** A sale waiting for upload, with the receipt it printed so it can be reprinted offline. */
export interface QueuedSale {
  sale: PosSaleInput;
  receipt: ReceiptData;
}

export type OutboxItem = QueuedSale;

/** An entry the server refused (4xx). Kept until someone retries or removes it. */
export type SyncProblem = OutboxProblem<OutboxItem>;

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
  outbox: OutboxItem[];
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

/**
 * Changes the outbox and the problem list together in one IndexedDB transaction, so a sale
 * moving between them is never in neither (or both) after a crash.
 */
export const changeQueue = (fn: (lists: OutboxLists<OutboxItem>) => OutboxLists<OutboxItem>) =>
  store(
    "readwrite",
    (kv) =>
      new Promise<void>((resolve, reject) => {
        const outbox = kv.get("outbox") as IDBRequest<OutboxItem[] | undefined>;
        const problems = kv.get("problems") as IDBRequest<SyncProblem[] | undefined>;
        // Requests run in order, so both reads are done here; writing in the callback keeps the transaction open.
        problems.onsuccess = () => {
          try {
            const next = fn({ outbox: outbox.result ?? [], problems: problems.result ?? [] });
            kv.put(next.outbox, "outbox");
            kv.put(next.problems, "problems");
            resolve(promisifyRequest(kv.transaction));
          } catch (err) {
            reject(err);
          }
        };
      }),
  );

function nextNumber(deviceCode: string, serverLast: string | null, local: Counter | undefined) {
  const fromServer = serverLast ? parsePosNumber(serverLast) : null;
  const candidates = [local?.deviceCode === deviceCode ? local : null, fromServer?.deviceCode === deviceCode ? fromServer : null];
  const last = candidates.reduce<{ period: string; value: number } | null>(
    (best, c) => (c && (!best || c.period > best.period || (c.period === best.period && c.value > best.value)) ? c : best),
    null,
  );
  return nextPosNumber(deviceCode, businessDate(), last);
}

/** The number the next sale will get (`K1-261113-0042`), for the top bar and the sale itself. */
export async function peekNumber(deviceCode: string, serverLast: string | null): Promise<string> {
  return nextNumber(deviceCode, serverLast, await read("counter")).number;
}

/**
 * Moves the device counter to a number taken from `peekNumber` once its sale happened, so a
 * sale refused for approval leaves no gap. The counter lives on the device so a receipt prints
 * offline; `serverLast` in `peekNumber` lets a wiped device continue after the server's numbers.
 */
export async function commitNumber(number: string): Promise<void> {
  const used = parsePosNumber(number);
  if (!used) return;
  await change("counter", (local) =>
    local?.deviceCode === used.deviceCode && (local.period > used.period || (local.period === used.period && local.value >= used.value))
      ? local
      : used,
  );
}

/**
 * Takes the sold quantities off the cached stock, in memory (`setCatalog`) and on the device,
 * so the next search already shows them. The server's figure replaces it on the next refresh.
 */
export async function deductSold(lines: readonly { productId: string; qty: number }[], setCatalog: (fn: (c: Catalog) => Catalog) => void) {
  const sold = new Map<string, number>();
  for (const line of lines) sold.set(line.productId, (sold.get(line.productId) ?? 0) + line.qty);
  const deduct = (catalog: Catalog): Catalog => ({
    ...catalog,
    products: catalog.products.map((p) => (sold.has(p.id) ? { ...p, stock: p.stock - sold.get(p.id)! } : p)),
  });
  setCatalog(deduct);
  const cached = await read("catalog");
  if (cached) await write("catalog", deduct(cached));
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
