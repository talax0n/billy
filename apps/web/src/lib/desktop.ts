import type { BillyDesktop } from "../../../desktop/src/bridge.ts";

/** The Electron shell's extras (apps/desktop preload). Undefined in a normal browser. */
export const desktop = (window as { billyDesktop?: BillyDesktop }).billyDesktop;
