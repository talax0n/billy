import { expect, test } from "@playwright/test";
import { ADMIN, docNumber, login, rp } from "../helpers.ts";

test("bundles the customer's open invoice; a bundle needs at least one invoice", async ({ page }) => {
  const number = docNumber("TF", 1);
  const open = docNumber("SO", 2);
  await login(page, ADMIN);
  await page.goto("/tukar-faktur");

  await page.getByRole("button", { name: "Tukar faktur baru" }).click();
  const sheet = page.getByRole("dialog", { name: "Tukar faktur baru" });
  await sheet.getByPlaceholder("Cari pelanggan…").fill("uji");
  await sheet.getByRole("option", { name: /CV Uji Pelanggan/ }).click();

  const invoice = sheet.getByRole("checkbox", { name: new RegExp(open) });
  await expect(invoice).toBeVisible();
  await expect(sheet.getByText(docNumber("SO", 1))).toBeHidden();

  await sheet.getByRole("button", { name: "Simpan tukar faktur" }).click();
  await expect(sheet.getByText("Pilih minimal satu faktur")).toBeVisible();

  await invoice.check();
  await expect(sheet.getByText(`1 faktur · ${rp(156_000)}`)).toBeVisible();
  await sheet.getByRole("button", { name: "Simpan tukar faktur" }).click();
  await expect(page.getByText(`${number} dibuat`)).toBeVisible();

  const detail = page.getByRole("dialog", { name: number });
  await expect(detail.getByRole("row", { name: new RegExp(open) })).toContainText(rp(156_000));
  await detail.getByRole("button", { name: "Tutup" }).click();
  await expect(page.getByRole("row", { name: new RegExp(`${number} CV Uji Pelanggan .* 1 ${rp(156_000)} ${rp(156_000)} Aktif`) })).toBeVisible();
});
