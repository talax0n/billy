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
  "settings.watchdog.update": { entity: "settings", label: "Pengaturan pengawasan diubah" },
  "settings.announcement.update": { entity: "settings", label: "Pengumuman diubah" },
  "approval_pin.set": { entity: "user", label: "PIN persetujuan diatur" },
  "category.create": { entity: "category", label: "Kategori dibuat" },
  "category.update": { entity: "category", label: "Kategori diubah" },
  "product.create": { entity: "product", label: "Produk dibuat" },
  "product.update": { entity: "product", label: "Produk diubah" },
  "stock.adjust": { entity: "product", label: "Penyesuaian stok" },
  "stock.opname.create": { entity: "stock_opname", label: "Stok opname dimulai" },
  "stock.opname.count": { entity: "stock_opname", label: "Hitungan opname disimpan" },
  "stock.opname.post": { entity: "stock_opname", label: "Stok opname diposting" },
  "contact.create": { entity: "contact", label: "Kontak dibuat" },
  "contact.update": { entity: "contact", label: "Kontak diubah" },
  "account.create": { entity: "account", label: "Akun kas dibuat" },
  "account.update": { entity: "account", label: "Akun kas diubah" },
  "cash.entry.create": { entity: "cash_entry", label: "Uang masuk/keluar" },
  "cash.transfer.create": { entity: "transfer", label: "Transfer antar akun" },
  "cash.transfer.void": { entity: "transfer", label: "Void transfer" },
  "expense.create": { entity: "expense", label: "Biaya dicatat" },
  "expense.void": { entity: "expense", label: "Void biaya" },
  "expense.edit": { entity: "expense", label: "Biaya diubah" },
  "sales.invoice.create": { entity: "sales_invoice", label: "Faktur penjualan dibuat" },
  "sales.invoice.void": { entity: "sales_invoice", label: "Void faktur penjualan" },
  "sales.invoice.edit": { entity: "sales_invoice", label: "Faktur penjualan diubah" },
  "sales.payment.create": { entity: "payment", label: "Pembayaran piutang" },
  "sales.payment.void": { entity: "payment", label: "Void pembayaran piutang" },
  "purchase.invoice.create": { entity: "purchase_invoice", label: "Faktur pembelian dibuat" },
  "purchase.invoice.void": { entity: "purchase_invoice", label: "Void faktur pembelian" },
  "purchase.invoice.edit": { entity: "purchase_invoice", label: "Faktur pembelian diubah" },
  "purchase.payment.create": { entity: "payment", label: "Pembayaran hutang" },
  "purchase.payment.void": { entity: "payment", label: "Void pembayaran hutang" },
  "invoice_bundle.create": { entity: "invoice_bundle", label: "Tukar faktur dibuat" },
  "invoice_bundle.void": { entity: "invoice_bundle", label: "Void tukar faktur" },
  "invoice_bundle.edit": { entity: "invoice_bundle", label: "Tukar faktur diubah" },
  "pos.sale.create": { entity: "pos_sale", label: "Penjualan kasir" },
  "pos.sale.void": { entity: "pos_sale", label: "Void struk kasir" },
  "pos.sale.revise": { entity: "pos_sale", label: "Revisi struk kasir" },
  "pos.sale.print": { entity: "pos_sale", label: "Cetak ulang struk" },
  "pos.draft.create": { entity: "pos_draft", label: "Nota sementara dibuat" },
  "pos.draft.update": { entity: "pos_draft", label: "Nota sementara diubah" },
  "pos.draft.print": { entity: "pos_draft", label: "Nota sementara dicetak" },
  "pos.draft.cancel": { entity: "pos_draft", label: "Nota sementara dibatalkan" },
  "pos.draft.pay": { entity: "pos_draft", label: "Nota sementara dibayar" },
  "quotation.create": { entity: "quotation", label: "Penawaran dibuat" },
  "quotation.status": { entity: "quotation", label: "Status penawaran diubah" },
  "quotation.convert": { entity: "quotation", label: "Penawaran jadi faktur" },
  "shift.open": { entity: "cash_shift", label: "Buka shift" },
  "shift.close": { entity: "cash_shift", label: "Tutup shift" },
  "approval.request": { entity: "approval", label: "Minta persetujuan" },
  "approval.approve": { entity: "approval", label: "Persetujuan diberikan" },
  "approval.reject": { entity: "approval", label: "Persetujuan ditolak" },
  "approval.pin_failed": { entity: "approval", label: "PIN admin salah" },
  "approval.pin_locked": { entity: "approval", label: "PIN dikunci" },
  "driver.create": { entity: "driver", label: "Sopir ditambah" },
  "driver.update": { entity: "driver", label: "Sopir diubah" },
  "delivery.create": { entity: "delivery", label: "Antaran masuk antrian" },
  "delivery.depart": { entity: "delivery", label: "Antaran berangkat" },
  "delivery.deliver": { entity: "delivery", label: "Antaran sampai" },
  "delivery.requeue": { entity: "delivery", label: "Antaran kembali ke antrian" },
  "delivery.cancel": { entity: "delivery", label: "Antaran dibatalkan" },
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
