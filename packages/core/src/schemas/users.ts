import { z } from "zod";

export const roles = ["admin", "staff", "kasir"] as const;
export type Role = (typeof roles)[number];

export const roleLabels: Record<Role, string> = { admin: "Admin", staff: "Staf", kasir: "Kasir" };

const password = z.string().min(8, "Kata sandi minimal 8 karakter").max(200);

export const loginInput = z.object({
  username: z.string().trim().toLowerCase().min(1, "Nama pengguna wajib diisi"),
  password: z.string().min(1, "Kata sandi wajib diisi"),
});
export type LoginInput = z.input<typeof loginInput>;

export const userCreateInput = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/, "3–32 karakter: huruf kecil, angka, titik, garis"),
  name: z.string().trim().min(1, "Nama wajib diisi").max(100),
  role: z.enum(roles),
  password,
});
export type UserCreateInput = z.input<typeof userCreateInput>;

export const userUpdateInput = z.object({
  name: z.string().trim().min(1, "Nama wajib diisi").max(100),
  role: z.enum(roles),
  active: z.boolean(),
  /** Blank keeps the current password. */
  password: z.union([z.literal(""), password]).default(""),
});
export type UserUpdateInput = z.input<typeof userUpdateInput>;
