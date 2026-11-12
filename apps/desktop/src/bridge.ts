/** What the preload exposes as `window.billyDesktop`. The web app imports this type to feature-detect the shell. */
export interface BillyDesktop {
  listPrinters(): Promise<Printer[]>;
  /** The saved receipt printer name; "" means the system default. */
  receiptPrinter(): Promise<string>;
  setReceiptPrinter(name: string): Promise<void>;
  /** Prints the current page with no dialog. The page's print CSS decides what shows (the receipt). */
  printReceipt(): Promise<void>;
}

export interface Printer {
  name: string;
  displayName: string;
}

