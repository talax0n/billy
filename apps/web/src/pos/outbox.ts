import { createFlush, initialSyncState, type SyncEvent, type SyncState, syncTransition } from "@billy/core";
import { useSyncExternalStore } from "react";
import { api } from "../lib/api.ts";
import { change, type QueuedSale, read, type SyncProblem } from "./local.ts";

/**
 * The offline outbox. Selling only ever writes to IndexedDB; this loop uploads queued sales
 * to `POST /api/pos/sales` in order, one at a time. A sale leaves the outbox only when the
 * server answers 2xx; a 4xx moves it to the visible problem list; anything else backs off
 * and retries. The loop and its phase are pure logic in @billy/core (`createFlush`, `syncTransition`).
 */

export interface OutboxSnapshot {
  sync: SyncState;
  pending: QueuedSale[];
  problems: SyncProblem[];
}

const POLL_MS = 15_000;

let snapshot: OutboxSnapshot = { sync: initialSyncState(navigator.onLine), pending: [], problems: [] };
const listeners = new Set<() => void>();
const flushedListeners = new Set<() => void>();
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function publish(next: Partial<OutboxSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

const dispatch = (event: SyncEvent) => publish({ sync: syncTransition(snapshot.sync, event) });

async function reload() {
  publish({ pending: (await read("outbox")) ?? [], problems: (await read("problems")) ?? [] });
}

async function upload(item: QueuedSale): Promise<{ status: number; error: string }> {
  try {
    const res = await api.pos.sales.$post({ json: item.sale });
    if (res.ok) return { status: res.status, error: "" };
    const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
    const fields = Object.entries(body.fields ?? {}).map(([field, message]) => `${field}: ${message}`);
    return { status: res.status, error: [body.error ?? `Gagal (${res.status})`, ...fields].join(" · ") };
  } catch {
    return { status: 0, error: "Tidak tersambung ke server" };
  }
}

/** Uploads the queue head-first until it is empty or the server cannot be reached. One loop at a time. */
export const flush = createFlush<QueuedSale>({
  next: async () => (await read("outbox"))?.[0],
  upload,
  settle: async (entry, problem) => {
    const id = entry.sale.id;
    if (problem) await change("problems", (list = []) => [...list, { ...entry, ...problem }]);
    await change("outbox", (list = []) => list.filter((q) => q.sale.id !== id));
    await reload();
  },
  state: () => snapshot.sync,
  dispatch,
  retryLater: (delayMs) => {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void flush(), delayMs);
  },
  accepted: () => {
    for (const listener of flushedListeners) listener();
  },
});

/** Queues a sale for upload. Resolves once it is stored on the device, never waits for the network. */
export async function queueSale(item: QueuedSale) {
  await change("outbox", (list = []) => [...list, item]);
  await reload();
  void flush();
}

/** Moves a refused sale back into the outbox, for after the cause was fixed on the server. */
export async function retryProblem(id: string) {
  const problem = snapshot.problems.find((p) => p.sale.id === id);
  if (!problem) return;
  await change("problems", (list = []) => list.filter((p) => p.sale.id !== id));
  await queueSale({ sale: problem.sale, receipt: problem.receipt });
}

/** Removes a refused sale for good, after the user confirmed it is handled elsewhere. */
export async function dismissProblem(id: string) {
  await change("problems", (list = []) => list.filter((p) => p.sale.id !== id));
  await reload();
}

/** Starts the loop: on load, when the browser comes online, and every 15 s. Returns a stop function. */
export function startOutbox(): () => void {
  const online = () => {
    dispatch({ type: "went_online" });
    void flush();
  };
  const offline = () => dispatch({ type: "went_offline" });
  window.addEventListener("online", online);
  window.addEventListener("offline", offline);
  const poll = setInterval(() => void flush(), POLL_MS);
  void reload().then(flush);
  return () => {
    window.removeEventListener("online", online);
    window.removeEventListener("offline", offline);
    clearInterval(poll);
    clearTimeout(retryTimer);
  };
}

/** Called after a flush in which the server accepted sales, e.g. to refresh stock in the catalog. */
export function onFlushed(listener: () => void): () => void {
  flushedListeners.add(listener);
  return () => flushedListeners.delete(listener);
}

export function useOutbox(): OutboxSnapshot {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}
