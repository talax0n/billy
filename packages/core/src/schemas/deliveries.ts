import { z } from "zod";
import { text } from "./common.ts";

export const driverInput = z.object({
  name: z.string().trim().min(1, "Nama sopir wajib diisi").max(80),
  phone: text(40),
});
export type DriverInput = z.input<typeof driverInput>;

export const driverUpdateInput = driverInput.extend({ active: z.boolean() });
export type DriverUpdateInput = z.input<typeof driverUpdateInput>;

/** Where the goods go. An empty name falls back to the customer of the nota or faktur. */
export const deliveryDetailsInput = z.object({
  customerName: text(120),
  address: z.string().trim().min(1, "Alamat antar wajib diisi").max(500),
  phone: text(40),
  note: text(300),
});
export type DeliveryDetailsInput = z.input<typeof deliveryDetailsInput>;

/** "Tambah antaran" on the page: optionally for a faktur, found by its number. */
export const deliveryCreateInput = deliveryDetailsInput.extend({
  invoiceNumber: z.string().trim().toUpperCase().max(40).default(""),
});
export type DeliveryCreateInput = z.input<typeof deliveryCreateInput>;

export const deliveryDepartInput = z.object({ driverId: z.uuid({ error: "Pilih sopir dulu" }) });

export const deliveryCancelInput = z.object({
  reason: z.string().trim().min(1, "Alasan batal wajib diisi").max(300),
});
