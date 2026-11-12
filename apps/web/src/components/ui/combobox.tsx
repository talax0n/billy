import { type KeyboardEvent, type ReactNode, useId, useState } from "react";
import { cx } from "../../lib/cx.ts";
import { controlClass } from "./field.tsx";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Muted text on the right, e.g. stock or code. */
  hint?: ReactNode;
}

/**
 * Type-to-search picker. The parent owns the search text (`query`/`onQueryChange`) so it can
 * fetch options from the server; ↑/↓ move, Enter picks, Esc closes.
 */
export function Combobox({
  id,
  options,
  query,
  onQueryChange,
  onSelect,
  placeholder,
  "aria-invalid": invalid,
}: {
  id?: string;
  options: ComboboxOption[];
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (option: ComboboxOption) => void;
  placeholder?: string;
  "aria-invalid"?: true;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  function pick(option: ComboboxOption | undefined) {
    if (!option) return;
    onSelect(option);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (options.length ? (i + step + options.length) % options.length : 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid}
        autoComplete="off"
        className={controlClass}
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          onQueryChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open && options.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-panel py-1"
        >
          {options.map((option, i) => (
            <li
              key={option.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(option);
              }}
              onMouseEnter={() => setActive(i)}
              className={cx("flex cursor-pointer justify-between gap-3 px-3 py-1.5", i === active && "bg-line-2")}
            >
              <span>{option.label}</span>
              {option.hint && <span className="text-muted tabular-nums">{option.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
