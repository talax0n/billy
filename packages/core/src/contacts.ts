export const contactKinds = ["customer", "supplier", "employee", "other"] as const;
export type ContactKind = (typeof contactKinds)[number];

export const contactKindLabels: Record<ContactKind, string> = {
  customer: "Pelanggan",
  supplier: "Pemasok",
  employee: "Karyawan",
  other: "Lainnya",
};

export const contactCodePrefix: Record<ContactKind, string> = {
  customer: "CUST",
  supplier: "SUPP",
  employee: "EMP",
  other: "OTH",
};

/**
 * The suggested code for a new contact: the kind's prefix and one past the highest number already
 * used with that prefix (`CUST-0007` after `CUST-0006`). Codes that do not follow the pattern are ignored.
 */
export function nextContactCode(kind: ContactKind, existingCodes: readonly string[]): string {
  const prefix = contactCodePrefix[kind];
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  const highest = existingCodes.reduce((max, code) => Math.max(max, Number(pattern.exec(code)?.[1] ?? 0)), 0);
  return `${prefix}-${String(highest + 1).padStart(4, "0")}`;
}
