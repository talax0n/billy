// Sandboxed preloads run as CommonJS and may require only "electron", hence the .cts and the inline channel names.
import electron = require("electron");
import type { BillyDesktop } from "./bridge.ts";

const billyDesktop: BillyDesktop = {
  listPrinters: () => electron.ipcRenderer.invoke("printers:list"),
  receiptPrinter: () => electron.ipcRenderer.invoke("printers:get"),
  setReceiptPrinter: (name) => electron.ipcRenderer.invoke("printers:set", name),
  printReceipt: () => electron.ipcRenderer.invoke("receipt:print"),
};

electron.contextBridge.exposeInMainWorld("billyDesktop", billyDesktop);
