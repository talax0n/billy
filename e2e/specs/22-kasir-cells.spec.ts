import { expect, test } from "@playwright/test";
import { ADMIN, KASIR, login } from "../helpers.ts";

test("kasir picks from the Produk view and edits qty and discount right in the cells", async ({ page }) => {
  await login(page, KASIR);
  await page.goto("/kasir");
  const search = page.getByLabel("Cari produk atau scan barcode");

  await page.getByRole("tab", { name: "Produk" }).click();
  await search.fill("kilau enamel putih");
  const product = page.getByRole("row").filter({ hasText: "Kilau Enamel Putih 1 L" });
  await product.click();
  await product.click();
  await expect(product.locator("td").last()).toHaveText("2");
  await page.screenshot({ path: "test-results/kasir-produk-view.png" });

  await page.getByRole("tab", { name: "Nota · 2" }).click();
  await expect(page.getByLabel("Qty baris 2"), "a re-added product gets its own line").toHaveValue("1");
  const qty = page.getByLabel("Qty baris 1");
  await expect(qty).toHaveValue("1");
  await qty.fill("5");
  await qty.press("Tab");
  const discount = page.getByLabel("Diskon baris 1");
  await expect(discount).toBeFocused();
  await discount.fill("999999999");
  await discount.press("Enter");
  await expect(discount).toHaveAttribute("aria-invalid", "true");
  await discount.fill("10000");
  await discount.press("Enter");
  await expect(search).toBeFocused();
  await expect(page.getByTestId("pos-total")).toContainText("458.000");
  await page.screenshot({ path: "test-results/kasir-cells.png" });

  await page.getByRole("button", { name: "Hapus baris 2" }).click();
  await page.getByRole("button", { name: "Hapus baris 1" }).click();
  await expect(page.getByText("Keranjang kosong")).toBeVisible();
});

test("dashboard KPIs show the exact rupiah, never rounded to jt or M", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/");
  const kpis = page.getByRole("region", { name: /Penjualan|Laba kotor|Arus kas bersih|Piutang terbuka|Hutang jatuh tempo/ });
  await expect(kpis).toHaveCount(5);
  for (const text of await kpis.allInnerTexts()) expect(text).toMatch(/Rp\s?[\d.]+$/m);
  await expect(kpis.filter({ hasText: / jt$| M$/m })).toHaveCount(0);
  await page.screenshot({ path: "test-results/dashboard-kpi.png" });
});
