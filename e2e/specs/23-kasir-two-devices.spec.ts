import { type Browser, expect, type Page, test } from "@playwright/test";
import { ADMIN, login } from "../helpers.ts";

async function atKasir(browser: Browser, user: typeof ADMIN) {
  const page = await (await browser.newContext()).newPage();
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await login(page, user);
  await page.goto("/kasir");
  await expect(page.getByTestId("sync-state")).toHaveText("Online");
  return page;
}

async function addThinner(page: Page) {
  const search = page.getByLabel("Cari produk atau scan barcode");
  await search.fill("thinner super 1");
  await expect(page.getByRole("listbox", { name: "Hasil pencarian" }).getByRole("option").first()).toContainText("Thinner Super 1 L");
  await search.press("Enter");
}

async function pay(page: Page) {
  await page.getByRole("button", { name: "Uang pas" }).click();
  await page.getByRole("button", { name: /Bayar & cetak struk/ }).click();
  await expect(page.getByText("Keranjang kosong")).toBeVisible();
}

const receiptNumber = (page: Page) => page.getByTestId("receipt").getByText(/^K1-\d{6}-\d{4}$/).textContent();
const draftsDialog = async (page: Page) => {
  await page.getByRole("button", { name: /^Nota sementara/ }).first().click();
  return page.getByRole("dialog", { name: "Nota sementara" });
};

test("two Kasir devices opened together each get their own receipt number, also paying a nota sementara", async ({ browser }) => {
  const first = await atKasir(browser, ADMIN);
  const second = await atKasir(browser, ADMIN);
  await addThinner(first);
  await pay(first);
  await addThinner(second);
  await pay(second);
  expect(await receiptNumber(second)).not.toBe(await receiptNumber(first));

  await addThinner(second);
  await (await draftsDialog(second)).getByRole("button", { name: "Simpan sebagai nota sementara" }).click();
  await expect(second.getByText("Keranjang kosong")).toBeVisible();
  await addThinner(first);
  await pay(first);
  const dialog = await draftsDialog(second);
  await dialog.getByRole("button", { name: /^Buka / }).click();
  await pay(second);
  expect(await receiptNumber(second)).not.toBe(await receiptNumber(first));
});
