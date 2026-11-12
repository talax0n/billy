import { Monitor, Moon, Sun } from "lucide-react";
import { cx } from "../../lib/cx.ts";
import { setTheme, type Theme, useTheme } from "../../lib/theme.ts";

const options: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Terang", icon: Sun },
  { value: "dark", label: "Gelap", icon: Moon },
  { value: "system", label: "Ikuti sistem", icon: Monitor },
];

export function ThemeToggle() {
  const theme = useTheme();
  return (
    <div role="radiogroup" aria-label="Tema" className="flex rounded-lg bg-line-2 p-0.5">
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
          className={cx(
            "flex h-6 flex-1 items-center justify-center rounded-md text-muted",
            theme === value && "bg-panel text-ink shadow-xs",
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
