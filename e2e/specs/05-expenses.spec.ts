import { expect, test } from "@playwright/test";
import { ADMIN, docNumber, login, rp } from "../helpers.ts";

test("records an expense and voids it; a void needs a reason", async ({ page }) => {
  const number = docNumber("BY", 1);
  await login(page, ADMIN);
  await page.goto("/biaya");

  await page.getByRole("button", { name: "Catat biaya" }).first().click();
  const form = page.getByRole("dialog", { name: "Catat biaya" });
  await form.getByLabel("Dibayar dari").selectOption({ label: "Kas Toko" });
  await form.getByLabel("Kategori").fill("Listrik");
  await form.getByLabel("Keterangan").fill("Token listrik November");
  await form.getByLabel("Jumlah").fill("75000");
  await form.getByRole("button", { name: "Simpan biaya" }).click();
  await expect(page.getByText(`Biaya ${number} dicatat`)).toBeVisible();
  await expect(page.getByText(/^Total biaya/).locator("..")).toContainText(rp(75_000));

  await page.getByRole("row", { name: new RegExp(`${number} Listrik Token listrik November Kas Toko ${rp(75_000)}`) }).click();
  const sheet = page.getByRole("dialog", { name: number });
  await sheet.getByRole("button", { name: "Void biaya" }).click();
  const voiding = page.getByRole("dialog", { name: `Void ${number}` });
  await voiding.getByRole("button", { name: "Void", exact: true }).click();
  await expect(voiding.getByText("Alasan void wajib diisi")).toBeVisible();

  await voiding.getByLabel("Alasan void").fill("Salah input");
  await voiding.getByRole("button", { name: "Void", exact: true }).click();
  await expect(page.getByText(`Biaya ${number} di-void`)).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(`${number}.*Void`) })).toBeVisible();
  await expect(page.getByText(/^Total biaya/).locator("..")).toContainText("Rp 0");

  await page.goto("/kas-bank");
  await expect(page.getByRole("row", { name: `KAS Kas Toko Kas ${rp(1_500_000)}` })).toBeVisible();
});
