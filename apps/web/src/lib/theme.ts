import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

const KEY = "theme";
const listeners = new Set<() => void>();

function read(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/** Persists the choice; `system` clears it so index.css follows the OS. index.html applies it before first paint. */
export function setTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked: the theme still applies for this page view.
  }
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  for (const listener of listeners) listener();
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
  );
}
