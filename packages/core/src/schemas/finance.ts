import { z } from "zod";
import { businessDateInput, paginationQuery, rupiahInput, text } from "./common.ts";

export const accountKinds = ["cash", "bank", "ewallet"] as const;
export const accountKindLabels: Record<(typeof accountKinds)[number], string> = {
  cash: "Kas",
  bank: "Bank",
  ewallet: "E-wallet",
};

export const cashCategories = ["sale", "purchase", "expense", "transfer", "other_in", "other_out", "reversal"] as const;
export const cashCategoryLabels: Record<(typeof cashCategories)[number], string> = {
  sale: "Penjualan",
  purchase: "Pembelian",
  expense: "Biaya",
  transfer: "Transfer",
  other_in: "Uang masuk lain",
  other_out: "Uang keluar lain",
  reversal: "Pembatalan",
};

/** Suggested in the Biaya form; any other text is allowed. */
export const expenseCategories = ["Gaji", "Listrik", "Air", "Sewa", "Transport", "Konsumsi", "Perlengkapan", "Lain-lain"];

const amount = rupiahInput.refine((value) => value > 0, "Jumlah harus lebih dari 0");
const account = (message: string) => z.uuid(message);
const proofUrl = z
  .union([z.literal(""), z.url("Tautan bukti tidak valid").max(1000)])
  .nullish()
  .transform((value) => value || null);

export const accountInput = z.object({
  code: z.string().trim().min(1, "Kode wajib diisi").max(40),
  name: z.string().trim().min(1, "Nama akun wajib diisi").max(200),
  kind: z.enum(accountKinds),
  active: z.boolean().default(true),
});
export type AccountInput = z.input<typeof accountInput>;

/** Uang masuk / uang keluar lain: a manual cash entry. The note says what the money was. */
export const cashEntryInput = z.object({
  accountId: account("Pilih akun"),
  date: businessDateInput,
  direction: z.enum(["in", "out"]),
  amount,
  note: z.string().trim().min(1, "Keterangan wajib diisi").max(500),
});
export type CashEntryInput = z.input<typeof cashEntryInput>;

export const transferInput = z
  .object({
    fromAccountId: account("Pilih akun asal"),
    toAccountId: account("Pilih akun tujuan"),
    date: businessDateInput,
    amount,
    note: text(500),
    proofUrl,
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, {
    path: ["toAccountId"],
    message: "Akun tujuan harus berbeda dari akun asal",
  });
export type TransferInput = z.input<typeof transferInput>;

export const expenseInput = z.object({
  date: businessDateInput,
  accountId: account("Pilih akun pembayar"),
  category: z.string().trim().min(1, "Kategori wajib diisi").max(100),
  description: text(500),
  amount,
  proofUrl,
});
export type ExpenseInput = z.input<typeof expenseInput>;

export const voidInput = z.object({ reason: z.string().trim().min(1, "Alasan void wajib diisi").max(500) });
export type VoidInput = z.input<typeof voidInput>;

export const cashBookQuery = paginationQuery.extend({
  from: businessDateInput.optional(),
  to: businessDateInput.optional(),
  direction: z.enum(["in", "out"]).optional(),
  category: z.enum(cashCategories).optional(),
});

export const expenseQuery = paginationQuery.extend({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
});
