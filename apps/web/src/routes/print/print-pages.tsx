import type { ReactNode } from "react";
import { BundlePrintPage } from "../invoice-bundles/bundle-print.tsx";
import { DeliveryNotePrintPage, InvoicePrintPage } from "../sales/invoice-print.tsx";

/** Printable documents, routed outside the app shell. Each takes the document id as `$id`. */
export const printPages: { path: string; page: () => ReactNode }[] = [
  { path: "/cetak/faktur/$id", page: InvoicePrintPage },
  { path: "/cetak/surat-jalan/$id", page: DeliveryNotePrintPage },
  { path: "/cetak/tukar-faktur/$id", page: BundlePrintPage },
];
