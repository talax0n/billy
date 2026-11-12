import { describe, expect, it } from "vitest";
import { createFlush, type FlushDeps, type OutboxEntry } from "./outbox.ts";
import { initialSyncState, type SyncState, syncTransition } from "./pos.ts";

const entry = (id: string): OutboxEntry => ({ sale: { id } });

/** An in-memory outbox whose uploads wait for `release()`. */
function fakeOutbox(ids: string[], status = 201) {
  const queue = ids.map(entry);
  const uploads: string[] = [];
  let state: SyncState = initialSyncState(true);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const deps: FlushDeps<OutboxEntry> = {
    next: async () => queue[0],
    upload: async (e) => {
      uploads.push(e.sale.id);
      await gate;
      return { status, error: "" };
    },
    settle: async (e) => {
      queue.splice(queue.findIndex((q) => q.sale.id === e.sale.id), 1);
    },
    state: () => state,
    dispatch: (event) => (state = syncTransition(state, event)),
    retryLater: () => {},
    accepted: () => {},
  };
  return { queue, uploads, release, flush: createFlush(deps), state: () => state };
}

describe("outbox flush", () => {
  it("runs one upload loop when flush is called again while it is syncing", async () => {
    const box = fakeOutbox(["a", "b"]);
    const first = box.flush();
    const second = box.flush();
    box.release();
    await Promise.all([first, second]);
    expect(box.uploads).toEqual(["a", "b"]);
    expect(box.state().phase).toBe("idle");
  });

  it("uploads a sale queued while a flush is running before it settles", async () => {
    const box = fakeOutbox(["a"]);
    const first = box.flush();
    box.queue.push(entry("b"));
    const second = box.flush();
    box.release();
    await Promise.all([first, second]);
    expect([box.uploads, box.queue]).toEqual([["a", "b"], []]);
  });
});
