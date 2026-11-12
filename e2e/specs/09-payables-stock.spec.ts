import { expect, test } from "@playwright/test";
import { ADMIN, docNumber, login, rp } from "../helpers.ts";

test("shows the open supplier bill and opens it from Hutang", async ({ page }) => {
  const po = docNumber("PO", 1);
  await login(page, ADMIN);
  await page.goto("/hutang");
  await expect(page.getByText(`Total hutang${rp(171_950)}`)).toBeVisible();

  await page.getByRole("row", { name: /PT Uji Pemasok/ }).click();
  const sheet = page.getByRole("dialog", { name: "PT Uji Pemasok" });
  await expect(sheet.getByText(`Hutang terbuka ${rp(171_950)}`)).toBeVisible();
  await sheet.getByRole("link", { name: po }).click();

  await expect(page).toHaveURL(/\/pembelian\?id=/);
  await expect(page.getByRole("dialog", { name: po }).getByText("Sebagian")).toBeVisible();
});

test("traces a product's movements and opens the sale behind one", async ({ page }) => {
  const so = docNumber("SO", 1);
  await login(page, ADMIN);
  await page.goto("/mutasi-stok");

  await page.getByPlaceholder("Semua produk (ketik untuk cari)").fill("thinner super 1");
  await page.getByRole("option", { name: /Thinner Super 1 L/ }).click();
  // 40 opening + 10 bought − 3 sold on SO-…-0001
  await expect(page.getByRole("row", { name: new RegExp(`Pembelian \\+10 botol 47 .*Pembelian ${docNumber("PO", 1)}`) })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(`Penjualan -3 botol 37 .*Penjualan ${so}`) })).toBeVisible();

  await page.getByRole("link", { name: `Penjualan ${so}` }).click();
  await expect(page).toHaveURL(/\/penjualan\?id=/);
  const invoice = page.getByRole("dialog", { name: so });
  await expect(invoice.getByText("Lunas")).toBeVisible();
  await expect(invoice.getByText(`Total${rp(466_000)}`).first()).toBeVisible();
});

test("refuses a second payment larger than the open bill", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/hutang");
  await page.getByRole("row", { name: /PT Uji Pemasok/ }).click();
  await page.getByRole("dialog", { name: "PT Uji Pemasok" }).getByRole("button", { name: "Bayar" }).click();
  const pay = page.getByRole("dialog", { name: "Catat pembayaran" });
  await pay.getByLabel("Dari akun").selectOption({ label: "Kas Toko" });
  await pay.getByLabel("Jumlah").fill("200000");
  await pay.getByRole("button", { name: "Simpan pembayaran" }).click();
  await expect(pay.getByText(`Pembayaran melebihi sisa hutang (${rp(171_950)})`).first()).toBeVisible();
});
