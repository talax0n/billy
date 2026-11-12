import { type Discount, rupiah, type Rupiah } from "@billy/core";
import type { CatalogProduct } from "./local.ts";

export interface CartLine {
  productId: string;
  name: string;
  variant: string;
  unit: string;
  categoryName: string | null;
  unitPrice: Rupiah;
  qty: number;
  discountAmount: Rupiah;
  /** Tinting colour code; a line with a note is not merged with a plain one. */
  note: string;
}

export interface Cart {
  lines: CartLine[];
  discount: Discount;
  /** Index of the selected line, the target of + − D N Del. */
  selected: number;
}

export const emptyCart: Cart = { lines: [], discount: { kind: "none", value: 0 }, selected: -1 };

export type CartAction =
  | { type: "add"; product: CatalogProduct }
  | { type: "select"; index: number }
  | { type: "qty"; index: number; qty: number }
  | { type: "discount"; index: number; amount: Rupiah }
  | { type: "note"; index: number; note: string }
  | { type: "remove"; index: number }
  | { type: "txDiscount"; discount: Discount }
  | { type: "load"; cart: Cart };

const patch = (cart: Cart, index: number, change: Partial<CartLine>): Cart => ({
  ...cart,
  lines: cart.lines.map((line, i) => (i === index ? { ...line, ...change } : line)),
});

export function cartReducer(cart: Cart, action: CartAction): Cart {
  switch (action.type) {
    case "add": {
      const p = action.product;
      const existing = cart.lines.findIndex((l) => l.productId === p.id && !l.note);
      if (existing >= 0) return { ...patch(cart, existing, { qty: cart.lines[existing]!.qty + 1 }), selected: existing };
      const line: CartLine = {
        productId: p.id,
        name: p.name,
        variant: p.variant,
        unit: p.unit,
        categoryName: p.categoryName,
        unitPrice: p.sellPrice,
        qty: 1,
        discountAmount: rupiah(0),
        note: "",
      };
      return { ...cart, lines: [...cart.lines, line], selected: cart.lines.length };
    }
    case "select":
      return { ...cart, selected: Math.max(0, Math.min(action.index, cart.lines.length - 1)) };
    case "qty":
      return action.qty < 1 ? cart : patch(cart, action.index, { qty: action.qty });
    case "discount":
      return patch(cart, action.index, { discountAmount: action.amount });
    case "note":
      return patch(cart, action.index, { note: action.note.trim() });
    case "remove": {
      const lines = cart.lines.filter((_, i) => i !== action.index);
      return { ...cart, lines, selected: Math.min(cart.selected, lines.length - 1) };
    }
    case "txDiscount":
      return { ...cart, discount: action.discount };
    case "load":
      return action.cart;
  }
}
