import { useSyncExternalStore } from "react";
import { cx } from "../../lib/cx.ts";

type Tone = "neutral" | "up" | "down";
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Shows a short message bottom-right for 4 seconds. Callable from anywhere, no provider needed. */
export function toast(message: string, tone: Tone = "neutral") {
  const id = nextId++;
  toasts = [...toasts, { id, message, tone }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 4000);
}

export function Toaster() {
  const items = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => toasts,
  );
  return (
    <div aria-live="polite" className="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {items.map((t) => (
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
    </div>
  );
}
