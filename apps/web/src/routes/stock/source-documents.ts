import type { InferResponseType } from "hono/client";
import type { api } from "../../lib/api.ts";

type SourceType = NonNullable<InferResponseType<typeof api.stock.movements.$get, 200>["rows"][number]["sourceType"]>;

/**
 * Where the document behind a stock movement opens, as `{path}?id={sourceId}`. Each page reads
 * its `id` search param and opens that document's sheet.
 */
export const sourceDocuments: Record<SourceType, { label: string; path: string }> = {
  purchase_invoice: { label: "Pembelian", path: "/pembelian" },
  sales_invoice: { label: "Penjualan", path: "/penjualan" },
  pos_sale: { label: "Kasir", path: "/riwayat-kasir" },
};
