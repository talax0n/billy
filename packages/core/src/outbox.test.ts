import { describe, expect, it } from "vitest";
import { createFlush, type FlushDeps, type OutboxEntry, requeueProblem, settleEntry } from "./outbox.ts";
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

describe("moves between the outbox and the problem list", () => {
  const a = { sale: { id: "a" }, receipt: "A" };
  const b = { sale: { id: "b" }, receipt: "B" };

  it("settles an accepted sale out of the outbox and a refused one into the problems", () => {
    const lists = { outbox: [a, b], problems: [] };
    expect(settleEntry(lists, a, null)).toEqual({ outbox: [b], problems: [] });
    expect(settleEntry(lists, a, { status: 422, error: "Produk nonaktif" })).toEqual({
      outbox: [b],
      problems: [{ sale: { id: "a" }, receipt: "A", status: 422, error: "Produk nonaktif" }],
    });
  });

  it("requeues a problem at the end of the outbox in one step, and ignores an unknown id", () => {
    const lists = { outbox: [b], problems: [{ ...a, status: 422, error: "Produk nonaktif" }] };
    expect(requeueProblem(lists, "a")).toEqual({ outbox: [b, a], problems: [] });
    expect(requeueProblem(lists, "x")).toBe(lists);
  });
});
