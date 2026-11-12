import { expect, type Page, test } from "@playwright/test";
import { ADMIN, login } from "../helpers.ts";

async function addContact(page: Page, kind: string, name: string, phone: string, termsDays: string) {
  await page.getByRole("button", { name: "Kontak baru" }).click();
  const sheet = page.getByRole("dialog", { name: "Kontak baru" });
  await sheet.getByLabel("Jenis").selectOption({ label: kind });
  await sheet.getByLabel("Nama").fill(name);
  await sheet.getByLabel("Telepon / WhatsApp").fill(phone);
  await sheet.getByLabel("Tempo pembayaran (hari)").fill(termsDays);
  await sheet.getByRole("button", { name: "Simpan kontak" }).click();
  await expect(page.getByText("Kontak disimpan")).toBeVisible();
  await expect(sheet).toBeHidden();
}

test("adds a customer and a supplier; a contact needs a name", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/kontak");

  await page.getByRole("button", { name: "Kontak baru" }).click();
  const sheet = page.getByRole("dialog", { name: "Kontak baru" });
  await sheet.getByRole("button", { name: "Simpan kontak" }).click();
  await expect(sheet.getByText("Nama wajib diisi")).toBeVisible();
  await sheet.getByRole("button", { name: "Tutup" }).click();

  await addContact(page, "Pelanggan", "CV Uji Pelanggan", "0812-0000-0001", "30");
  await addContact(page, "Pemasok", "PT Uji Pemasok", "021-555-0101", "14");

  await expect(page.getByRole("row", { name: "CUST-0001 CV Uji Pelanggan Pelanggan 0812-0000-0001 30 hari" })).toBeVisible();
  await expect(page.getByRole("row", { name: "SUPP-0001 PT Uji Pemasok Pemasok 021-555-0101 14 hari" })).toBeVisible();

  await page.getByLabel("Jenis kontak").selectOption({ label: "Pemasok" });
  await expect(page.getByRole("row", { name: /CV Uji Pelanggan/ })).toBeHidden();
  await expect(page.getByText("1–1 dari 1")).toBeVisible();
});
