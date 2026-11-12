declare const rupiahBrand: unique symbol;

/** Whole rupiah. Never a float, never a formatted string. */
export type Rupiah = number & { readonly [rupiahBrand]: true };

export function rupiah(value: number): Rupiah {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Rupiah must be a safe integer, got ${value}`);
  }
  return value as Rupiah;
}

export function sumRupiah(values: readonly Rupiah[]): Rupiah {
  return rupiah(values.reduce((total, v) => total + v, 0));
}

const idr = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const idrShort = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

/**
 * `Rp 1.250.000`; negatives get a real minus before the symbol: `−Rp 250.000`.
 * `compact` shortens millions and billions: `Rp 1,3 jt`, `Rp 2 M`.
 */
export function formatRupiah(value: Rupiah, { compact = false } = {}): string {
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  const unit = !compact ? null : abs >= 1e9 ? ([1e9, "M"] as const) : abs >= 1e6 ? ([1e6, "jt"] as const) : null;
  const digits = unit ? `${idrShort.format(abs / unit[0])} ${unit[1]}` : idr.format(abs);
  return `${sign}Rp ${digits}`;
}

export function parseRupiah(input: string): Rupiah {
  const digits = input.replace(/^\s*Rp\.?\s*/i, "").replace(/\./g, "").trim();
  if (!/^-?\d+$/.test(digits)) {
    throw new SyntaxError(`Not a rupiah amount: "${input}"`);
  }
  return rupiah(Number(digits));
}
