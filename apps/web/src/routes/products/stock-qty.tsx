import { stockLevel } from "@billy/core";
import { cx } from "../../lib/cx.ts";

const qty = new Intl.NumberFormat("id-ID");

/** Stock with its unit: red when negative (oversold), amber when under the minimum or empty. */
export function StockQty({ product }: { product: { stock: number; minStock: number; unit: string } }) {
  const { stock, minStock, unit } = product;
  return (
    <span className={cx("tabular-nums", { negative: "text-down", low: "text-warn", empty: "text-warn", ok: undefined }[stockLevel(stock, minStock)])}>
      {qty.format(stock)} <span className="text-muted">{unit}</span>
    </span>
  );
}
