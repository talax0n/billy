import { cx } from "../../lib/cx.ts";

const qty = new Intl.NumberFormat("id-ID");

/** Stock with its unit: red when negative (oversold), amber at or below the minimum. */
export function StockQty({ product }: { product: { stock: number; minStock: number; unit: string } }) {
  const { stock, minStock, unit } = product;
  return (
    <span className={cx("tabular-nums", stock < 0 ? "text-down" : stock <= minStock && "text-warn")}>
      {qty.format(stock)} <span className="text-muted">{unit}</span>
    </span>
  );
}
