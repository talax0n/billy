import { z } from "zod";
import { text } from "./common.ts";

export const settingsInput = z.object({
  shopName: z.string().trim().min(1, "Nama toko wajib diisi").max(120),
  address: text(500),
  phone: text(40),
  whatsapp: text(40),
  invoiceBankText: text(500),
  invoiceSigner: text(100),
  receiptFooter: text(500),
  posDeviceCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,4}$/, "1–4 huruf atau angka, misal K1"),
});
export type SettingsInput = z.input<typeof settingsInput>;
