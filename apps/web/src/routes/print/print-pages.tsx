import { lazyRouteComponent, type RouteComponent } from "@tanstack/react-router";
const BundlePrintPage = lazyRouteComponent(() => import("../invoice-bundles/bundle-print.tsx"), "BundlePrintPage");
const QuotationPrintPage = lazyRouteComponent(() => import("../quotations/quotation-print.tsx"), "QuotationPrintPage");
const DeliveryNotePrintPage = lazyRouteComponent(() => import("../sales/invoice-print.tsx"), "DeliveryNotePrintPage");
const InvoicePrintPage = lazyRouteComponent(() => import("../sales/invoice-print.tsx"), "InvoicePrintPage");

/** Printable documents, routed outside the app shell. Each takes the document id as `$id`. */
export const printPages: { path: string; page: RouteComponent }[] = [
  { path: "/cetak/faktur/$id", page: InvoicePrintPage },
  { path: "/cetak/surat-jalan/$id", page: DeliveryNotePrintPage },
  { path: "/cetak/tukar-faktur/$id", page: BundlePrintPage },
  { path: "/cetak/penawaran/$id", page: QuotationPrintPage },
];
