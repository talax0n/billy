import type { PosMethod } from "@billy/core";
import { useState } from "react";
import type { Catalog } from "./local.ts";
import type { PaperWidth } from "./receipt.tsx";

/** Per-device cashier setup: which account each payment method pays into, and the paper width. */
export interface PosPreferences {
  accounts: Partial<Record<PosMethod, string>>;
  paper: PaperWidth;
}

const KEY = "pos-preferences";

function load(): PosPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as PosPreferences | null;
    if (stored) return stored;
  } catch {
    // Unreadable or blocked storage: start from the defaults.
  }
  return { accounts: {}, paper: 80 };
}

export function usePosPreferences() {
  const [prefs, setPrefs] = useState(load);
  const save = (next: PosPreferences) => {
    setPrefs(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Storage blocked: the choice holds for this page view.
    }
  };
  return [prefs, save] as const;
}

const defaultKinds: Record<PosMethod, Catalog["accounts"][number]["kind"][]> = {
  cash: ["cash"],
  qris: ["ewallet", "bank"],
  transfer: ["bank"],
};

/** The account a method pays into: the device's choice while it is still active, else the first of a fitting kind. */
export function accountFor(method: PosMethod, prefs: PosPreferences, accounts: Catalog["accounts"]) {
  const chosen = accounts.find((a) => a.id === prefs.accounts[method]);
  if (chosen) return chosen;
  for (const kind of defaultKinds[method]) {
    const match = accounts.find((a) => a.kind === kind);
    if (match) return match;
  }
  return accounts[0];
}
