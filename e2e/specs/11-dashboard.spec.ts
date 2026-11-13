import { expect, type Page, test } from "@playwright/test";
import { ADMIN, login, rp } from "../helpers.ts";

const card = (page: Page, title: string) => page.getByRole("heading", { name: title, level: 2 }).locator("..");

test("Overview and Perlu Tindakan count the sales made earlier in the run", async ({ page }) => {
  await login(page, ADMIN);
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();

  // Invoices 466.000 + 156.000; cashier 110.000 + 32.000.
  await expect(card(page, "Penjualan")).toContainText(rp(764_000));
  await expect(card(page, "Penjualan")).toContainText(`Faktur ${rp(622_000)} · Kasir ${rp(142_000)}`);
  // 764.000 sold at a cost of 609.500 (cost snapshots taken at each sale).
  await expect(card(page, "Laba kotor")).toContainText(rp(154_500));
  await expect(card(page, "Piutang terbuka")).toContainText(rp(156_000));
  await expect(page.getByRole("row", { name: `1 Kas Toko ${rp(1_808_000)} +${rp(1_808_000)}` })).toBeVisible();
  await expect(page.getByRole("row", { name: `2 BCA Operasional ${rp(700_000)} +${rp(700_000)}` })).toBeVisible();

  // The second invoice took Kilau Enamel Merah from 7 to 5, below its minimum of 6.
  await page.getByRole("button", { name: "Perlu tindakan: 3" }).click();
  await expect(page.getByRole("link", { name: /Stok rendah Kilau Enamel/ })).toBeVisible();
  await page.getByRole("link", { name: "Lihat semua" }).click();
  await expect(page).toHaveURL(/\/tindakan$/);
  await expect(page.getByRole("row", { name: /Stok rendah Kilau Enamel Stok 5 · Minimum 6/ })).toBeVisible();
  await expect(page.getByText("1–3 dari 3")).toBeVisible();
});

test("refuses a custom period that ends before it starts", async ({ page }) => {
  await login(page, ADMIN);
  await page.getByLabel("Periode").selectOption({ label: "Tanggal khusus" });
  await page.getByLabel("Dari tanggal").fill("2026-11-10");
  await page.getByLabel("Sampai tanggal").fill("2026-11-01");
  await expect(page.getByRole("alert")).toContainText("Rentang tanggal tidak valid");
  await expect(card(page, "Penjualan")).toBeHidden();
});
