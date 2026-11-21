import { expect, type Page, test } from "@playwright/test";
import { ADMIN, KASIR, login } from "../helpers.ts";

const payButton = (page: Page) => page.getByRole("button", { name: /Bayar & cetak struk/ });
const search = (page: Page) => page.getByLabel("Cari produk atau scan barcode");

test("a transfer struk prints the shop's rekening; a cash struk does not", async ({ page, browser }) => {
  const admin = await browser.newPage();
  await login(admin, ADMIN);
  await admin.goto("/pengaturan");
  await admin.getByLabel("Rekening di faktur").fill("BCA 123-456-7890 a.n. Toko Uji");
  await admin.getByRole("button", { name: "Simpan data toko" }).click();
  await expect(admin.getByText(/tersimpan/i).first()).toBeVisible();
  await admin.close();

  await page.addInitScript(() => {
    window.print = () => {};
  });
  await login(page, KASIR);
  const receipt = page.getByTestId("receipt");

  await search(page).fill("thinner super 1");
  await search(page).press("Enter");
  await page.getByRole("radiogroup", { name: "Metode bayar" }).getByRole("radio", { name: "Transfer" }).click();
  await payButton(page).click();
  await expect(receipt).toContainText("Transfer");
  await expect(page.getByTestId("receipt-bank")).toHaveText("BCA 123-456-7890 a.n. Toko Uji");

  await search(page).fill("thinner super 1");
  await search(page).press("Enter");
  await page.getByRole("radiogroup", { name: "Metode bayar" }).getByRole("radio", { name: "Tunai" }).click();
  await page.getByRole("button", { name: "Uang pas" }).click();
  await payButton(page).click();
  await expect(receipt).toContainText("Tunai");
  await expect(page.getByTestId("receipt-bank")).toBeHidden();
});
