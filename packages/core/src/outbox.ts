import { retryDelay, type SyncEvent, type SyncState, uploadOutcome } from "./pos.ts";
import type { Role } from "./schemas/users.ts";

/**
 * A sale, or a shift opening or closing, waiting in the POS outbox. They share one queue so the
 * server sees a shift's open, then its sales, then its close. Extra fields (the printed
 * receipt, the counted cash) ride along untouched.
 */
export type OutboxEntry =
  /** `cashierId`: who made the sale; absent on sales queued before it was recorded. */
  | { sale: { id: string; cashierId?: string | undefined } }
  | { shift: { event: "open" | "close"; id: string; cashierId: string } };

/** An entry's identity in the queue: a shift's open and close share the shift id. */
export const entryKey = (entry: OutboxEntry) => ("sale" in entry ? entry.sale.id : `${entry.shift.event}:${entry.shift.id}`);

/**
 * Whether `user`, signed in on this device, uploads this queued entry. A kasir uploads only
 * their own; another cashier's entry waits until that cashier signs in again. Admin and staff
 * upload every entry, and the server records it under the cashier who made it.
 */
export function mayUpload(entry: OutboxEntry, user: { id: string; role: Role }) {
  const cashierId = "sale" in entry ? entry.sale.cashierId : entry.shift.cashierId;
  return user.role !== "kasir" || cashierId === undefined || cashierId === user.id;
}

/** What the flush loop needs from the device and the network. */
export interface FlushDeps<T extends OutboxEntry> {
  /** The next entry to upload, or undefined when none is left. */
  next(): Promise<T | undefined>;
  upload(entry: T): Promise<{ status: number; error: string }>;
  /** Takes the entry out of the outbox; a refused one goes to the problem list with `result`. */
  settle(entry: T, result: { status: number; error: string } | null): Promise<void>;
  state(): SyncState;
  dispatch(event: SyncEvent): void;
  retryLater(delayMs: number): void;
  /** Called after a flush in which the server accepted at least one sale. */
  accepted(): void;
}

/**
 * The outbox flush: uploads entries head-first until none is left or the server cannot be
 * reached. A sale leaves the outbox only on 2xx; a 4xx moves it to the problem list.
 * One loop at a time: a call while it runs (poll, a new sale) returns the same promise and
 * makes the loop run once more (unless it is backing off), so two loops never upload the same head.
 */
export function createFlush<T extends OutboxEntry>(deps: FlushDeps<T>): () => Promise<void> {
  let running: Promise<void> | undefined;
  let again = false;
  return () => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      let reached: boolean;
      do {
        again = false;
        reached = await flushOnce(deps);
      } while (again && reached);
    })().finally(() => (running = undefined));
    return running;
  };
}

/** One pass over the outbox. False when it stopped because the server could not be reached. */
async function flushOnce<T extends OutboxEntry>(deps: FlushDeps<T>): Promise<boolean> {
  deps.dispatch({ type: "flush" });
  if (deps.state().phase !== "syncing") return false;
  let accepted = 0;
  for (let head = await deps.next(); head; head = await deps.next()) {
    const result = await deps.upload(head);
    const outcome = uploadOutcome(result.status);
    if (outcome === "retry") {
      deps.dispatch({ type: "failed" });
      deps.retryLater(retryDelay(deps.state().failures));
      return false;
    }
    if (outcome === "done") accepted++;
    await deps.settle(head, outcome === "rejected" ? result : null);
  }
  deps.dispatch({ type: "flushed", at: new Date().toISOString() });
  if (accepted > 0) deps.accepted();
  return true;
}

/** A sale the server refused (4xx), kept until someone retries or removes it. */
export type OutboxProblem<T extends OutboxEntry> = T & { status: number; error: string };

/** Both device lists. Every move between them is one change of this pair, written in one transaction. */
export interface OutboxLists<T extends OutboxEntry> {
  outbox: T[];
  problems: OutboxProblem<T>[];
}

/** Takes an uploaded sale out of the outbox; a refused one moves to the problem list. */
export function settleEntry<T extends OutboxEntry>(
  lists: OutboxLists<T>,
  entry: T,
  problem: { status: number; error: string } | null,
): OutboxLists<T> {
  return {
    outbox: lists.outbox.filter((q) => entryKey(q) !== entryKey(entry)),
    problems: problem ? [...lists.problems, { ...entry, ...problem }] : lists.problems,
  };
}

/** Moves a refused entry (by `entryKey`) back to the end of the outbox, for after its cause was fixed. */
export function requeueProblem<T extends OutboxEntry>(lists: OutboxLists<T>, key: string): OutboxLists<T> {
  const problem = lists.problems.find((p) => entryKey(p) === key);
  if (!problem) return lists;
  const { status: _status, error: _error, ...entry } = problem;
  return {
    outbox: [...lists.outbox, entry as unknown as T],
    problems: lists.problems.filter((p) => entryKey(p) !== key),
  };
}
