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

export function formatRupiah(value: Rupiah): string {
  return `Rp ${idr.format(value)}`;
}

export function parseRupiah(input: string): Rupiah {
  const digits = input.replace(/^\s*Rp\.?\s*/i, "").replace(/\./g, "").trim();
  if (!/^-?\d+$/.test(digits)) {
    throw new SyntaxError(`Not a rupiah amount: "${input}"`);
  }
  return rupiah(Number(digits));
}
