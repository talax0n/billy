import { z } from "zod";
import { businessDateInput, paginationQuery } from "./schemas/common.ts";

/** Where an audited change came from. `kasir_offline`: a Kasir sale made offline and synced later. */
export const auditSources = ["web", "kasir", "kasir_offline", "system"] as const;
export type AuditSource = (typeof auditSources)[number];

export const auditSourceLabels: Record<AuditSource, string> = {
  web: "Kantor",
  kasir: "Kasir",
  kasir_offline: "Kasir (offline)",
  system: "Sistem",
};

/**
 * Every action the audit log records, with the entity it touches and its label in Log Aktivitas.
 * `audit_events.action` is plain text, so a later phase adds an action here without a migration.
 */
export const auditActions = {
  "auth.login": { entity: "user", label: "Masuk" },
  "auth.login_failed": { entity: "user", label: "Gagal masuk" },
  "auth.logout": { entity: "user", label: "Keluar" },
  "user.create": { entity: "user", label: "Pengguna dibuat" },
  "user.update": { entity: "user", label: "Pengguna diubah" },
  "settings.update": { entity: "settings", label: "Pengaturan toko diubah" },
  "settings.limits.update": { entity: "settings", label: "Batas kasir diubah" },
  "approval_pin.set": { entity: "user", label: "PIN persetujuan diatur" },
  "category.create": { entity: "category", label: "Kategori dibuat" },
  "category.update": { entity: "category", label: "Kategori diubah" },
  "product.create": { entity: "product", label: "Produk dibuat" },
  "product.update": { entity: "product", label: "Produk diubah" },
  "stock.adjust": { entity: "product", label: "Penyesuaian stok" },
  "contact.create": { entity: "contact", label: "Kontak dibuat" },
  "contact.update": { entity: "contact", label: "Kontak diubah" },
  "account.create": { entity: "account", label: "Akun kas dibuat" },
  "account.update": { entity: "account", label: "Akun kas diubah" },
  "cash.entry.create": { entity: "cash_entry", label: "Uang masuk/keluar" },
  "cash.transfer.create": { entity: "transfer", label: "Transfer antar akun" },
  "cash.transfer.void": { entity: "transfer", label: "Void transfer" },
  "expense.create": { entity: "expense", label: "Biaya dicatat" },
  "expense.void": { entity: "expense", label: "Void biaya" },
  "sales.invoice.create": { entity: "sales_invoice", label: "Faktur penjualan dibuat" },
  "sales.invoice.void": { entity: "sales_invoice", label: "Void faktur penjualan" },
  "sales.payment.create": { entity: "payment", label: "Pembayaran piutang" },
  "sales.payment.void": { entity: "payment", label: "Void pembayaran piutang" },
  "purchase.invoice.create": { entity: "purchase_invoice", label: "Faktur pembelian dibuat" },
  "purchase.invoice.void": { entity: "purchase_invoice", label: "Void faktur pembelian" },
  "purchase.payment.create": { entity: "payment", label: "Pembayaran hutang" },
  "purchase.payment.void": { entity: "payment", label: "Void pembayaran hutang" },
  "invoice_bundle.create": { entity: "invoice_bundle", label: "Tukar faktur dibuat" },
  "invoice_bundle.void": { entity: "invoice_bundle", label: "Void tukar faktur" },
  "pos.sale.create": { entity: "pos_sale", label: "Penjualan kasir" },
  "pos.sale.void": { entity: "pos_sale", label: "Void struk kasir" },
  "approval.request": { entity: "approval", label: "Minta persetujuan" },
  "approval.approve": { entity: "approval", label: "Persetujuan diberikan" },
  "approval.reject": { entity: "approval", label: "Persetujuan ditolak" },
  "approval.pin_failed": { entity: "approval", label: "PIN admin salah" },
  "approval.pin_locked": { entity: "approval", label: "PIN dikunci" },
} as const satisfies Record<string, { entity: string; label: string }>;

export type AuditAction = keyof typeof auditActions;
export const auditActionNames = Object.keys(auditActions) as [AuditAction, ...AuditAction[]];

export const auditQuery = paginationQuery.extend({
  actorId: z.uuid().optional(),
  action: z.enum(auditActionNames).optional(),
  from: businessDateInput.optional(),
  to: businessDateInput.optional(),
});
export type AuditQuery = z.input<typeof auditQuery>;

/**
 * The fields that differ between two snapshots, each side holding only those fields.
 * Null when nothing changed.
 */
export function changedFields<T extends Record<string, unknown>>(before: T, after: T): { before: Partial<T>; after: Partial<T> } | null {
  const changed = Object.keys(after).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  if (changed.length === 0) return null;
  const pick = (from: T) => Object.fromEntries(changed.map((key) => [key, from[key] ?? null])) as Partial<T>;
  return { before: pick(before), after: pick(after) };
}
