/** Pure parsers for the legacy E-Jurnal export (.legacy/). Formats are what its pages print. */

/** "Rp. 3.460.000,00", "10.020.000", "-Rp. 5,00" → whole rupiah (cents dropped; the legacy app has none). */
export function money(text: string | undefined): number {
  if (!text) return 0;
  const clean = text.replace(/<[^>]+>/g, "").trim();
  const negative = clean.includes("-");
  const whole = clean.split(",")[0]!.replace(/\D/g, "");
  return whole ? (negative ? -1 : 1) * Number(whole) : 0;
}

/** "12/11/2026" → "2026-11-12"; "2026-11-12" passes through. */
export function isoDate(text: string): string {
  const t = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (!m) throw new Error(`Unreadable date "${text}"`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export const normName = (name: string) => name.replace(/\s+/g, " ").trim().toUpperCase();

/** "11%" → 1100 basis points. */
export const percentToBp = (text: string | undefined) => Math.round(Number((text ?? "0").replace(/[^\d.,]/g, "").replace(",", ".") || 0) * 100);

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** "C261112-410" → "C-261112-0410", the shape the POS number schema accepts. */
export function posNumber(legacy: string): string {
  const m = /^([A-Z]+)(\d{6})-(\d+)$/.exec(legacy.trim());
  if (!m) throw new Error(`Unreadable receipt number "${legacy}"`);
  return `${m[1]}-${m[2]}-${m[3]!.padStart(4, "0")}`;
}

export interface ReceiptLine {
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

/**
 * Item rows of a printed receipt: ["KUAS HOMECARE 2,5 IN 2 x 16.000", "32.000"], optionally with a
 * line discount "(-123.000)" after the price. Summary rows are skipped. A negative qty (a return
 * typed as a sale) is read as its absolute value, since the amount printed is positive.
 */
export function receiptLines(rows: string[][]): ReceiptLine[] {
  return rows.flatMap(([item, amount]) => {
    const m = /^(.+?) (-?\d+) x ([\d.]+)(?: \(-[\d.]+\))?$/.exec(item?.trim() ?? "");
    return m ? [{ name: m[1]!.trim(), qty: Math.abs(Number(m[2])) || 1, unitPrice: money(m[3]), lineTotal: money(amount) }] : [];
  });
}

/** A receipt's summary row by label ("Subtotal", "Diskon", "Total Dibayar"). */
export const receiptAmount = (rows: string[][], label: string) => money(rows.find(([l]) => l?.trim() === label)?.[1]);

/** "KANSAI ECO CLEAN 20 LITER (BRILLIANT WHITE)" → name and the tint note in parentheses. */
export function splitTint(name: string): { name: string; note: string } {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(name);
  return m ? { name: m[1]!, note: m[2]!.trim() } : { name, note: "" };
}

export const ADJUSTMENT_NOTE = "Selisih impor (data lama)";

export interface AdjustedReceipt {
  /** The receipt's goods, priced as the main import prices them; a printed line total under qty × price is a line discount. */
  lines: (ReceiptLine & { discountAmount: number; appLineTotal: number })[];
  discount: number;
  /** What the app's lines and discount add up to. */
  computedTotal: number;
  /** The printed "Total Tagihan", kept as the document total. */
  total: number;
  /** total − computedTotal: the "Selisih impor" line, which moves no stock. Can be negative. */
  adjustment: number;
  /** Sum of every line, adjustment included, so subtotal − discount = total. */
  subtotal: number;
}

/**
 * A receipt whose printed total the app's arithmetic cannot reproduce (most often a printed line
 * total above qty × price). The legacy total stands; the gap becomes one adjustment line.
 */
export function adjustedReceipt(rows: string[][]): AdjustedReceipt {
  const lines = receiptLines(rows).map((l) => {
    const gross = l.qty * l.unitPrice;
    const discountAmount = Math.max(0, gross - l.lineTotal);
    return { ...l, discountAmount, appLineTotal: gross - discountAmount };
  });
  const discount = receiptAmount(rows, "Diskon");
  const total = receiptAmount(rows, "Total Tagihan");
  const computedTotal = lines.reduce((sum, l) => sum + l.appLineTotal, 0) - discount;
  const adjustment = total - computedTotal;
  if (total < 0) throw new Error("Negative receipt total");
  return { lines, discount, computedTotal, total, adjustment, subtotal: total + discount };
}
