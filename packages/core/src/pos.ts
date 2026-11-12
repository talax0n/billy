import { DomainError } from "./errors.ts";
import { computeTotals, type Discount, type LineInput, type Totals } from "./invoice.ts";
import { rupiah, type Rupiah } from "./money.ts";

export interface CartTotals extends Totals {
  /** Sum of qty × price before any discount: the "Subtotal" row of the payment panel. */
  gross: Rupiah;
  /** Sum of the line discounts: the "Diskon baris" row. */
  lineDiscount: Rupiah;
}

const zero = rupiah(0);
export const emptyCartTotals: CartTotals = {
  lineTotals: [],
  subtotal: zero,
  discountAmount: zero,
  taxAmount: zero,
  total: zero,
  gross: zero,
  lineDiscount: zero,
};

/** Totals of a POS cart; an empty cart is all zeros. Invalid discounts come back as a message. */
export function cartTotals(
  lines: readonly LineInput[],
  discount: Discount,
): { ok: true; totals: CartTotals } | { ok: false; error: string } {
  if (lines.length === 0) return { ok: true, totals: emptyCartTotals };
  try {
    const totals = computeTotals(lines, discount);
    const lineDiscount = rupiah(lines.reduce((sum, l) => sum + l.discountAmount, 0));
    return { ok: true, totals: { ...totals, gross: rupiah(totals.subtotal + lineDiscount), lineDiscount } };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

const TENDER_STEPS = [1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000];

/**
 * Up to three cash amounts a customer is likely to hand over, above the exact total.
 * Steps smaller than 1% of the total are skipped, so a 2.432.000 sale suggests
 * 2.450.000 / 2.500.000 / 3.000.000 rather than 2.433.000.
 */
export function quickTenderAmounts(total: Rupiah): Rupiah[] {
  if (total <= 0) return [];
  const amounts = new Set<number>();
  for (const step of TENDER_STEPS) {
    if (step * 100 < total) continue;
    const rounded = Math.ceil(total / step) * step;
    if (rounded > total) amounts.add(rounded);
  }
  return [...amounts].slice(0, 3).map(rupiah);
}

/** Outcome of uploading one queued sale, from the HTTP status (0 = no response). */
export type UploadOutcome = "done" | "rejected" | "retry";

/**
 * 2xx: the server holds the sale (a replay of a known id also answers 200).
 * 4xx: the server refused this sale; retrying cannot help, so it goes to the problem list.
 * 401 (session expired), 408, 429, 5xx and no response: try again later.
 */
export function uploadOutcome(status: number): UploadOutcome {
  if (status >= 200 && status < 300) return "done";
  if (status >= 400 && status < 500 && ![401, 408, 429].includes(status)) return "rejected";
  return "retry";
}

/**
 * The outbox sync loop. `offline`: the browser reports no network. `idle`: nothing in
 * flight. `syncing`: uploading queued sales in order. `backoff`: the last attempt could not
 * reach the server; the next one waits `retryDelay(failures)`.
 */
export type SyncPhase = "offline" | "idle" | "syncing" | "backoff";

export interface SyncState {
  phase: SyncPhase;
  /** Consecutive failed attempts; resets on a successful flush. */
  failures: number;
  /** ISO time of the last flush that emptied the outbox. */
  lastSyncedAt: string | null;
}

export type SyncEvent =
  | { type: "went_offline" }
  | { type: "went_online" }
  | { type: "flush" }
  | { type: "flushed"; at: string }
  | { type: "failed" };

export const initialSyncState = (online: boolean): SyncState => ({
  phase: online ? "idle" : "offline",
  failures: 0,
  lastSyncedAt: null,
});

/** Pure transition function. Events that do not apply in the current phase leave it unchanged. */
export function syncTransition(state: SyncState, event: SyncEvent): SyncState {
  switch (event.type) {
    case "went_offline":
      return { ...state, phase: "offline" };
    case "went_online":
      return state.phase === "offline" ? { ...state, phase: "idle" } : state;
    case "flush":
      return state.phase === "idle" || state.phase === "backoff" ? { ...state, phase: "syncing" } : state;
    case "flushed":
      return state.phase === "syncing" ? { ...state, phase: "idle", failures: 0, lastSyncedAt: event.at } : state;
    case "failed":
      return state.phase === "syncing" ? { ...state, phase: "backoff", failures: state.failures + 1 } : state;
  }
}

/** Exponential backoff after `failures` failed attempts: 2 s, 4 s, 8 s … capped at 60 s. */
export function retryDelay(failures: number): number {
  return Math.min(1000 * 2 ** failures, 60_000);
}

/** `K1-261113-0042` → `{ deviceCode: "K1", period: "261113", value: 42 }`; null for anything else. */
export function parsePosNumber(number: string): { deviceCode: string; period: string; value: number } | null {
  const match = /^([A-Z0-9]{1,4})-(\d{6})-(\d{4,})$/.exec(number);
  return match ? { deviceCode: match[1]!, period: match[2]!, value: Number(match[3]) } : null;
}
