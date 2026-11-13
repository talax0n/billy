import { type ReactNode, useState } from "react";
import { cx } from "../../lib/cx.ts";

/**
 * Shows `content` under the wrapped element on hover or keyboard focus. The panel is `fixed`, so a
 * parent with `overflow: hidden` does not clip it.
 */
export function Tooltip({ content, className, children }: { content: ReactNode; className?: string; children: ReactNode }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setAt({ left: Math.min(r.left + 12, window.innerWidth - 292), top: r.bottom - 8 });
  };
  return (
    <div
      tabIndex={0}
      className={cx("outline-none focus-visible:ring-2 focus-visible:ring-ink/20", className)}
      onMouseEnter={(e) => show(e.currentTarget)}
      onFocus={(e) => show(e.currentTarget)}
      onMouseLeave={() => setAt(null)}
      onBlur={() => setAt(null)}
    >
      {children}
      {at && (
        <div
          role="tooltip"
          style={{ left: at.left, top: at.top }}
          className="pointer-events-none fixed z-50 w-max max-w-[280px] rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-xl"
        >
          {content}
        </div>
      )}
    </div>
  );
}
