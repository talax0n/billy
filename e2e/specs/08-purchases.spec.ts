import { expect, test } from "@playwright/test";
import { ADMIN, docNumber, login, rp } from "../helpers.ts";

test("buys stock with PPN and pays part of it; a purchase needs a supplier", async ({ page }) => {
  const number = docNumber("PO", 1);
  await login(page, ADMIN);
  await page.goto("/pembelian");

  await page.getByRole("button", { name: "Pembelian baru" }).click();
  const form = page.getByRole("dialog", { name: "Pembelian baru" });
  await form.getByRole("button", { name: "Simpan faktur" }).click();
  await expect(form.getByText("Pilih pemasok")).toBeVisible();

  await form.getByPlaceholder("Cari nama atau kode pemasok").fill("uji");
  await form.getByRole("option", { name: /PT Uji Pemasok/ }).click();
  await expect(form.getByLabel("Termin (hari)")).toHaveValue("14");
  await form.getByLabel("No. faktur pemasok").fill("INV-77");

  const entry = form.getByPlaceholder("Ketik nama barang, Enter untuk menambah");
  await entry.fill("thinner super 1");
  await expect(form.getByRole("listbox").getByRole("option").first()).toContainText("Thinner Super 1 L");
  await entry.press("Enter");
  const qty = form.getByLabel("Qty baris 1");
  await expect(qty).toBeFocused();
  await qty.fill("10");
  await expect(form.getByLabel("Harga satuan baris 1")).toHaveValue("24.500");

  await expect(form.getByText(`Subtotal${rp(245_000)}`)).toBeVisible();
  await expect(form.getByText(`PPN 11%${rp(26_950)}`)).toBeVisible();
  await expect(form.getByText(`Total${rp(271_950)}`)).toBeVisible();
  await form.getByRole("button", { name: "Simpan faktur" }).click();
  await expect(page.getByText(`Faktur ${number} disimpan`)).toBeVisible();

  const sheet = page.getByRole("dialog", { name: number });
  await expect(sheet.getByText("Belum bayar")).toBeVisible();
  await sheet.getByRole("button", { name: "Catat pembayaran" }).click();
  const pay = page.getByRole("dialog", { name: "Catat pembayaran" });
  await pay.getByLabel("Dari akun").selectOption({ label: "Kas Toko" });
  await pay.getByLabel("Jumlah").fill("100000");
  await pay.getByRole("button", { name: "Simpan pembayaran" }).click();
  await expect(page.getByText(`Sisa hutang ${rp(171_950)}`)).toBeVisible();
  await expect(sheet.getByText("Sebagian")).toBeVisible();
});
