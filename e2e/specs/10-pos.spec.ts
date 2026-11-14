import { expect, type Page, test } from "@playwright/test";
import { ADMIN, docNumber, KASIR, login, rp, num } from "../helpers.ts";

const search = (page: Page) => page.getByLabel("Cari produk atau scan barcode");
const results = (page: Page) => page.getByRole("listbox", { name: "Hasil pencarian" });
const payButton = (page: Page) => page.getByRole("button", { name: /Bayar & cetak struk/ });

async function addProduct(page: Page, query: string, label: string, stock: number) {
  await search(page).fill(query);
  const first = results(page).getByRole("option").first();
  await expect(first).toContainText(label);
  await expect(first).toContainText(`stok ${stock}`);
  await search(page).press("Enter");
}

test("sells online and offline; the offline sale syncs and reaches Riwayat Kasir", async ({ page, browser }) => {
  // The receipt prints through window.print(); headless has no printer to talk to.
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await login(page, KASIR);
  await expect(page).toHaveURL(/\/kasir$/);
  await expect(page.getByTestId("sync-state")).toHaveText("Online");

  await page.keyboard.press("F3");
  const picker = page.getByRole("dialog", { name: "Pelanggan" });
  await picker.getByLabel("Cari pelanggan").fill("uji");
  await expect(picker.getByRole("option", { name: /CV Uji Pelanggan/ })).toBeVisible();
  await picker.getByLabel("Cari pelanggan").press("Enter");
  await expect(page.getByText("Pelanggan CV Uji Pelanggan")).toBeVisible();

  // 22 opening; 47 = 40 opening + 10 bought − 3 sold on the first invoice.
  await addProduct(page, "kilau enamel putih", "Kilau Enamel Putih 1 L", 22);
  await addProduct(page, "thinner super 1", "Thinner Super 1 L", 47);
  await expect(page.getByText("Total", { exact: true }).locator("..")).toContainText("110.000");
  await search(page).press("Enter");
  await expect(page.getByText("Pelanggan Umum")).toBeVisible();
  await expect(page.getByTestId("sync-pending")).toHaveText("");

  // The cached stock drops as soon as the sale is made.
  await search(page).fill("thinner super 1");
  await expect(results(page).getByRole("option").first()).toContainText("stok 46");
  await search(page).press("Escape");

  await page.route("**/api/**", (route) => route.abort());
  await addProduct(page, "thinner super 1", "Thinner Super 1 L", 46);
  await page.getByLabel("Uang diterima").fill("10000");
  await expect(page.getByText("Kurang")).toBeVisible();
  await expect(payButton(page)).toBeDisabled();
  await page.getByRole("button", { name: "Uang pas" }).click();
  await payButton(page).click();
  await expect(page.getByTestId("sync-state")).toHaveText("Offline");
  await expect(page.getByTestId("sync-pending")).toHaveText(" · 1 transaksi menunggu sinkron");

  await page.unroute("**/api/**");
  await expect(page.getByTestId("sync-pending")).toHaveText("", { timeout: 30_000 });
  await expect(page.getByTestId("sync-state")).toHaveText("Online");

  const admin = await browser.newPage();
  await login(admin, ADMIN);
  await admin.goto("/riwayat-kasir");
  await expect(admin.getByRole("row", { name: new RegExp(`${docNumber("K1", 1)} .* Kasir Satu Tunai · Kas Toko Lunas ${num(110_000)}`) })).toBeVisible();
  await expect(admin.getByRole("row", { name: new RegExp(`${docNumber("K1", 2)} .* Kasir Satu Tunai · Kas Toko Lunas ${num(32_000)}`) })).toBeVisible();

  await admin.goto("/mutasi-stok");
  await admin.getByRole("link", { name: `Kasir ${docNumber("K1", 2)}` }).click();
  await expect(admin).toHaveURL(/\/riwayat-kasir\?id=/);
  await expect(admin.getByRole("dialog", { name: docNumber("K1", 2) })).toContainText(rp(32_000));
  await admin.close();
});
