import { expect, test } from "@playwright/test";
import { ADMIN, login, rp } from "../helpers.ts";

test("creates a product and adjusts its stock; an adjustment needs a reason", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/produk");
  await page.getByRole("button", { name: "Produk baru" }).click();

  const form = page.getByRole("dialog", { name: "Produk baru" });
  await form.getByLabel("Nama").fill("Cat Uji Kilap");
  await form.getByLabel("Varian").fill("Biru 1 L");
  await form.getByLabel("Satuan").fill("kaleng");
  await form.getByLabel("Kode").fill("E2E-001");
  await form.getByLabel("Harga jual").fill("50000");
  await form.getByLabel("Harga pokok").fill("40000");
  await form.getByLabel("Stok minimum").fill("2");
  await form.getByRole("button", { name: "Simpan produk" }).click();

  const sheet = page.getByRole("dialog", { name: "Cat Uji Kilap Biru 1 L" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Rp 50.000", { exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Sesuaikan stok" }).click();

  const adjust = page.getByRole("dialog", { name: "Sesuaikan stok" });
  await adjust.getByLabel("Jumlah (kaleng)").fill("10");
  await adjust.getByRole("button", { name: "Simpan penyesuaian" }).click();
  await expect(adjust.getByText("Alasan penyesuaian wajib diisi")).toBeVisible();

  await adjust.getByLabel("Alasan").fill("Stok awal");
  await adjust.getByRole("button", { name: "Simpan penyesuaian" }).click();
  await expect(page.getByText("Stok sekarang 10 kaleng")).toBeVisible();
  await expect(sheet.getByRole("row", { name: /Penyesuaian.*\+10.*Stok awal/ })).toBeVisible();

  await sheet.getByRole("button", { name: "Tutup" }).click();
  await page.getByPlaceholder(/Cari/).fill("E2E-001");
  await expect(page.getByRole("row", { name: `E2E-001 Cat Uji Kilap Biru 1 L — ${rp(50_000)} 10 kaleng` })).toBeVisible();
});
