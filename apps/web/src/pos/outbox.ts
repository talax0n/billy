import {
  createFlush,
  entryKey,
  initialSyncState,
  mayUpload,
  type PosRevisionInput,
  type PosSaleInput,
  requeueProblem,
  type Role,
  settleEntry,
  type SyncEvent,
  type SyncState,
  syncTransition,
} from "@billy/core";
import { useSyncExternalStore } from "react";
import { api } from "../lib/api.ts";
import { change, changeQueue, type OutboxItem, read, type SyncProblem } from "./local.ts";

/**
 * The offline outbox. Online, the Kasir sends a sale straight to the server with `sendSale`, so
 * a limit that needs an admin's approval is caught at the counter. Offline, or when that send
 * fails to reach the server, the sale is queued here. This loop uploads the queue
 * in order, one at a time, skipping another cashier's entries when a
 * kasir is signed in. A sale leaves the outbox only when the
 * server answers 2xx; a 4xx moves it to the visible problem list; anything else backs off
 * and retries. The loop and its phase are pure logic in @billy/core (`createFlush`, `syncTransition`).
 */

export interface OutboxSnapshot {
  sync: SyncState;
  pending: OutboxItem[];
  /** Pending entries of another cashier: they upload when that cashier signs in again. */
  othersPending: number;
  problems: SyncProblem[];
}

/** The signed-in user; set by `startOutbox`. Nothing uploads before. */
let user: { id: string; role: Role } | undefined;
const mine = (entry: OutboxItem) => user !== undefined && mayUpload(entry, user);

const POLL_MS = 15_000;

let snapshot: OutboxSnapshot = { sync: initialSyncState(navigator.onLine), pending: [], othersPending: 0, problems: [] };
const listeners = new Set<() => void>();
const flushedListeners = new Set<() => void>();
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function publish(next: Partial<OutboxSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

const dispatch = (event: SyncEvent) => publish({ sync: syncTransition(snapshot.sync, event) });

async function reload() {
  const pending = (await read("outbox")) ?? [];
  publish({ pending, othersPending: pending.filter((q) => !mine(q)).length, problems: (await read("problems")) ?? [] });
}

export interface UploadResult {
  /** 0 when the server could not be reached in time. */
  status: number;
  error: string;
  /** The server refused the sale until an admin approves it. */
  needsApproval: boolean;
}

/** One request, given up after `timeoutMs` so a dead connection never holds the cashier. */
async function send(request: (init: { init: RequestInit }) => Promise<Response>, timeoutMs: number): Promise<UploadResult> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await request({ init: { signal: abort.signal } });
    if (res.ok) return { status: res.status, error: "", needsApproval: false };
    const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string>; approval?: object };
    const fields = Object.entries(body.fields ?? {}).map(([field, message]) => `${field}: ${message}`);
    return { status: res.status, error: [body.error ?? `Gagal (${res.status})`, ...fields].join(" · "), needsApproval: Boolean(body.approval) };
  } catch {
    return { status: 0, error: "Tidak tersambung ke server", needsApproval: false };
  } finally {
    clearTimeout(timer);
  }
}

export const sendSale = (sale: PosSaleInput, timeoutMs = 15_000) => send((init) => api.pos.sales.$post({ json: sale }, init), timeoutMs);

/** Paying a nota sementara: online only, never queued. */
export const sendDraftPayment = (draftId: string, sale: PosSaleInput) =>
  send((init) => api.pos.drafts[":id"].pay.$post({ param: { id: draftId }, json: sale }, init), 15_000);

/** A revisi of a paid nota: online only, never queued. */
export const sendRevision = (originalId: string, revision: PosRevisionInput) =>
  send((init) => api.pos.sales[":id"].revise.$post({ param: { id: originalId }, json: revision }, init), 15_000);


/** Uploads the queue head-first until it is empty or the server cannot be reached. One loop at a time. */
export const flush = createFlush<OutboxItem>({
  next: async () => (await read("outbox"))?.find(mine),
  upload: (item) => sendSale(item.sale),
  settle: async (entry, problem) => {
    await changeQueue((lists) => settleEntry(lists, entry, problem));
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
export async function queue(item: OutboxItem) {
  await change("outbox", (list = []) => [...list, item]);
  await reload();
  void flush();
}

/** Moves a refused entry (by `entryKey`) back into the outbox, for after the cause was fixed on the server. */
export async function retryProblem(key: string) {
  await changeQueue((lists) => requeueProblem(lists, key));
  await reload();
  void flush();
}

/** Removes a refused entry for good, after the user confirmed it is handled elsewhere. */
export async function dismissProblem(key: string) {
  await change("problems", (list = []) => list.filter((p) => entryKey(p) !== key));
  await reload();
}

/**
 * Starts the loop for the signed-in user: on load, when the browser comes online, and every
 * 15 s. Returns a stop function.
 */
export function startOutbox(signedIn: { id: string; role: Role }): () => void {
  user = signedIn;
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
    user = undefined;
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
