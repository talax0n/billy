import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cx } from "../../lib/cx.ts";

type Tone = "neutral" | "up" | "down";
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

/**
 * An open modal `<dialog>` sits in the browser's top layer, above any z-index, and makes the
 * rest of the page inert. Toasts therefore render inside the topmost open dialog when there is one.
 */
const topLayer = () => [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].at(-1) ?? document.body;

let state: { toasts: Toast[]; host: HTMLElement } = { toasts: [], host: document.body };
let nextId = 1;
const listeners = new Set<() => void>();
function emit(toasts = state.toasts) {
  state = { toasts, host: topLayer() };
  listeners.forEach((listener) => listener());
}

/** Moves the toasts into the dialog that just opened, or out of the one that just closed. */
export const restackToasts = () => emit();

/** Shows a short message bottom-right for 4 seconds. Callable from anywhere, no provider needed. */
export function toast(message: string, tone: Tone = "neutral") {
  const id = nextId++;
  emit([...state.toasts, { id, message, tone }]);
  setTimeout(() => emit(state.toasts.filter((t) => t.id !== id)), 4000);
}

export function Toaster() {
  const { toasts, host } = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
  return createPortal(
    <div aria-live="polite" className="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cx(
            "rounded-lg border border-line bg-panel px-4 py-2.5 font-medium",
            t.tone === "up" && "text-up",
            t.tone === "down" && "text-down",
          )}
        >
          {t.message}
        </div>
      ))}
    </div>,
    host,
  );
}
