import { ipcMain, type IpcMainInvokeEvent, type WebContentsPrintOptions } from "electron";
import type { Printer } from "./bridge.ts";
import { saveSettings, settings } from "./settings.ts";
import { onOrigin } from "./window.ts";

/** IPC for window.billyDesktop. Only pages from the app's own origin may call it. */
export function registerPrinting(origin: string) {
  const handle = (channel: string, fn: (event: IpcMainInvokeEvent, arg: unknown) => unknown) =>
    ipcMain.handle(channel, (event, arg: unknown) => {
      if (!event.senderFrame || !onOrigin(event.senderFrame.url, origin)) throw new Error("forbidden");
      return fn(event, arg);
    });

  handle("printers:list", async (event): Promise<Printer[]> =>
    (await event.sender.getPrintersAsync()).map(({ name, displayName }) => ({ name, displayName })),
  );
  handle("printers:get", () => settings().receiptPrinter ?? "");
  handle("printers:set", (_event, name) => saveSettings({ receiptPrinter: String(name) }));
  handle("receipt:print", (event) => {
    const options: WebContentsPrintOptions = { silent: true, printBackground: true, margins: { marginType: "none" } };
    const printer = settings().receiptPrinter;
    if (printer) options.deviceName = printer;
    return new Promise<void>((resolve, reject) =>
      event.sender.print(options, (ok, reason) => (ok ? resolve() : reject(new Error(reason)))),
    );
  });
}
