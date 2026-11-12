import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { cx } from "../../lib/cx.ts";
import { Button } from "./button.tsx";

/**
 * Modal on the native `<dialog>`: focus trap, Esc and top layer come from the browser.
 * `side="right"` renders it as a full-height side sheet.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  side,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  side?: "right";
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={cx(
        "border border-line bg-panel p-0 text-ink backdrop:bg-scrim",
        side === "right"
          ? "my-0 mr-0 ml-auto h-dvh max-h-dvh w-full max-w-xl rounded-l-xl"
          : "m-auto w-full max-w-md rounded-xl",
        className,
      )}
    >
      {open && (
        <div className="flex h-full flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div>
              <h2 className="text-base font-semibold tracking-tight">{title}</h2>
              {description && <p className="mt-0.5 text-muted">{description}</p>}
            </div>
            <Button variant="ghost" size="icon" aria-label="Tutup" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </header>
          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

/** Same as `Dialog side="right"`: the detail/edit panel of a list page. */
export const Sheet = (props: Omit<Parameters<typeof Dialog>[0], "side">) => <Dialog side="right" {...props} />;
