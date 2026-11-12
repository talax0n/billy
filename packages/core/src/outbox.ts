import { retryDelay, type SyncEvent, type SyncState, uploadOutcome } from "./pos.ts";

/** A sale waiting in the POS outbox. Extra fields (the printed receipt) ride along untouched. */
export interface OutboxEntry {
  sale: { id: string };
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
