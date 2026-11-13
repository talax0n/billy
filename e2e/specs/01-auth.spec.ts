import { expect, test } from "@playwright/test";
import { ADMIN, KASIR, login } from "../helpers.ts";

test("admin creates a kasir, who only ever reaches the cashier", async ({ page }) => {
  await login(page, ADMIN);
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();

  await page.goto("/pengaturan");
  await page.getByRole("tab", { name: "Pengguna" }).click();
  await page.getByRole("button", { name: "Pengguna baru" }).click();
  const sheet = page.getByRole("dialog", { name: "Pengguna baru" });
  await sheet.getByLabel("Nama", { exact: true }).fill("Kasir Satu");
  await sheet.getByLabel("Nama pengguna").fill(KASIR.username);
  await sheet.getByLabel("Peran").selectOption({ label: "Kasir" });
  await sheet.getByLabel("Kata sandi").fill(KASIR.password);
  await sheet.getByRole("button", { name: "Buat pengguna" }).click();
  await expect(page.getByText("Pengguna disimpan")).toBeVisible();
  await expect(page.getByRole("row", { name: /Kasir Satu kasir1 Kasir Aktif/ })).toBeVisible();

  await page.getByRole("button", { name: "Keluar" }).click();
  await expect(page).toHaveURL(/\/login/);

  await login(page, KASIR);
  await expect(page).toHaveURL(/\/kasir$/);
  await expect(page.getByText("Kasir Satu")).toBeVisible();

  await page.goto("/penjualan");
  await expect(page).toHaveURL(/\/kasir$/);
  const sales = await page.request.get("/api/sales");
  expect(sales.status()).toBe(403);
});

test("a wrong password is refused", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Nama pengguna").fill(ADMIN.username);
  await page.getByLabel("Kata sandi").fill("salah-sekali");
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByText("Nama pengguna atau kata sandi salah")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
