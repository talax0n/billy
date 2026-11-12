import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, type Rectangle } from "electron";

/** Per-PC settings, kept in the userData folder next to the web app's IndexedDB. */
export interface Settings {
  /** Overrides the default API origin, e.g. the Vercel URL. `BILLY_API_URL` wins over it. */
  apiUrl?: string;
  /** Printer name for silent receipt printing. Unset prints to the system default. */
  receiptPrinter?: string;
  bounds?: Rectangle;
  maximized?: boolean;
}

const file = () => join(app.getPath("userData"), "settings.json");
let current: Settings | undefined;

export function settings(): Settings {
  if (!current) {
    try {
      current = JSON.parse(readFileSync(file(), "utf8")) as Settings;
    } catch {
      current = {};
    }
  }
  return current;
}

export function saveSettings(patch: Settings) {
  current = { ...settings(), ...patch };
  writeFileSync(file(), JSON.stringify(current, null, 2));
}
