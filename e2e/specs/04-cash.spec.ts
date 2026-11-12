import { expect, test } from "@playwright/test";
import { ADMIN, login, rp } from "../helpers.ts";

test("records money in and a transfer; a transfer needs two different accounts", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/kas-bank");

  await page.getByRole("button", { name: "Uang masuk" }).click();
  const moneyIn = page.getByRole("dialog", { name: "Uang masuk lain" });
  await moneyIn.getByLabel("Masuk ke akun").selectOption({ label: "Kas Toko" });
  await moneyIn.getByLabel("Jumlah").fill("2000000");
  await moneyIn.getByLabel("Keterangan").fill("Modal awal");
  await moneyIn.getByRole("button", { name: "Catat uang masuk" }).click();
  await expect(page.getByText("Uang masuk dicatat")).toBeVisible();

  await page.getByRole("button", { name: "Transfer" }).click();
  const transfer = page.getByRole("dialog", { name: "Transfer antar akun" });
  await transfer.getByLabel("Dari akun").selectOption({ label: "Kas Toko" });
  await transfer.getByLabel("Ke akun").selectOption({ label: "Kas Toko" });
  await transfer.getByLabel("Jumlah").fill("500000");
  await transfer.getByRole("button", { name: "Simpan transfer" }).click();
  await expect(transfer.getByText("Akun tujuan harus berbeda dari akun asal")).toBeVisible();

  await transfer.getByLabel("Ke akun").selectOption({ label: "BCA Operasional" });
  await transfer.getByLabel("Catatan").fill("Setor ke bank");
  await transfer.getByRole("button", { name: "Simpan transfer" }).click();
  await expect(page.getByText("Transfer dicatat")).toBeVisible();

  await expect(page.getByRole("row", { name: `KAS Kas Toko Kas ${rp(1_500_000)}` })).toBeVisible();
  await expect(page.getByRole("row", { name: `BCA BCA Operasional Bank ${rp(500_000)}` })).toBeVisible();
  await expect(page.getByText(`Total saldo kas & bank${rp(2_000_000)}`)).toBeVisible();

  await page.getByRole("row", { name: /Kas Toko/ }).click();
  const sheet = page.getByRole("dialog", { name: "Kas Toko" });
  await expect(sheet.getByRole("row", { name: new RegExp(`Modal awal.*${rp(2_000_000)}`) })).toBeVisible();
  await expect(sheet.getByRole("row", { name: new RegExp(`Setor ke bank.*${rp(500_000)}.*${rp(1_500_000)}`) })).toBeVisible();
});
