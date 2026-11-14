import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { ADMIN, login, rp } from "../helpers.ts";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

test("Ubah a paid faktur, follow both links, then find its payment in Laporan Kas and export it", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/penjualan");

  await page.getByRole("button", { name: "Faktur baru" }).click();
  const form = page.getByRole("dialog", { name: "Faktur penjualan baru" });
  await form.getByPlaceholder("Cari pelanggan…").fill("uji");
  await form.getByRole("option", { name: /CV Uji Pelanggan/ }).click();
  const picker = form.getByPlaceholder("Ketik nama barang…").last();
  await picker.fill("thinner super 1");
  await expect(form.getByRole("listbox").getByRole("option").first()).toContainText("Thinner Super 1 L");
  await picker.press("Enter");
  await form.getByLabel("Jumlah baris 1").fill("2");
  await form.getByRole("button", { name: "Simpan faktur" }).click();

  const original = page.getByRole("dialog", { name: /^SO-\d{6}-\d{4}$/ });
  await expect(original.getByText("Belum bayar")).toBeVisible();
  const number = (await original.getByRole("heading").first().textContent())!.trim();

  await original.getByRole("button", { name: "Catat pembayaran" }).click();
  const pay = page.getByRole("dialog", { name: "Catat pembayaran" });
  await pay.getByLabel("Masuk ke akun").selectOption({ label: "Kas Toko" });
  await pay.getByLabel("Jumlah").fill("50000");
  await pay.getByRole("button", { name: "Simpan pembayaran" }).click();
  await expect(original.getByText("Sebagian")).toBeVisible();

  // Ubah: three thinners instead of two at 10% off; the 50.000 already paid moves to the new faktur.
  await original.getByRole("button", { name: "Ubah" }).click();
  const edit = page.getByRole("dialog", { name: `Ubah ${number}` });
  await expect(edit.getByLabel("Jumlah baris 1")).toHaveValue("2");
  await edit.getByLabel("Jumlah baris 1").fill("3");
  const due = new Date(`${today()}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 20);
  await edit.getByLabel("Jatuh tempo").fill(due.toISOString().slice(0, 10));
  const totals = edit.getByRole("complementary", { name: "Total" });
  await expect(totals).toContainText(`Terbayar${rp(50_000)}`);
  await expect(totals).toContainText(`Sisa tagihan${rp(46_000)}`);
  await edit.getByRole("button", { name: "+ diskon baris" }).click();
  await edit.getByLabel("Jenis diskon baris 1").selectOption("%");
  await edit.getByLabel("Diskon persen baris 1").fill("10");
  await expect(totals).toContainText(`Sisa tagihan${rp(36_400)}`);
  await edit.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(edit.getByText("Alasan perubahan wajib diisi")).toBeVisible();
  await edit.getByLabel("Alasan perubahan").fill("Pelanggan tambah satu");
  await edit.getByRole("button", { name: "Simpan perubahan" }).click();

  const revised = page.getByRole("dialog", { name: `${number}/R1` });
  await expect(revised.getByRole("row", { name: `Total ${rp(86_400)}`, exact: true })).toBeVisible();
  await expect(revised.getByText(`Terbayar${rp(50_000)}`)).toBeVisible();
  await expect(revised.getByText("tempo 20 hari")).toBeVisible();
  await revised.getByRole("link", { name: `Perubahan dari ${number}` }).click();

  const replaced = page.getByRole("dialog", { name: number, exact: true });
  await expect(replaced.getByText("Alasan void: Diubah: Pelanggan tambah satu")).toBeVisible();
  await replaced.getByRole("link", { name: `Diubah → ${number}/R1` }).click();
  await expect(page.getByRole("dialog", { name: `${number}/R1` })).toBeVisible();
  await page.getByRole("dialog", { name: `${number}/R1` }).getByRole("button", { name: "Tutup" }).click();

  // Laporan Kas: a tab of Kas & Biaya.
  await page.goto("/kas-bank");
  await page.getByRole("navigation", { name: "Kas & Biaya" }).getByRole("link", { name: "Laporan Kas" }).click();
  await expect(page).toHaveURL(/\/laporan-kas$/);
  await expect(page.getByRole("link", { name: "Laporan Debit Kredit" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Kas & Biaya", exact: true })).not.toHaveAttribute("aria-current", "page");
  await page.goto("/kas-bank");
  await page.getByRole("link", { name: "Laporan Debit Kredit" }).click();
  await expect(page).toHaveURL(/\/laporan-kas$/);
  await page.getByLabel("Akun", { exact: true }).selectOption({ label: "Kas Toko" });
  await page.getByLabel("Sumber", { exact: true }).selectOption({ label: "Pembayaran piutang" });
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: `${number}/R1` }) });
  await expect(row).toContainText(rp(50_000));
  await expect(page.getByText("Saldo awal")).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Ekspor Excel" }).click()]);
  const month = today().slice(0, 8);
  expect(download.suggestedFilename()).toBe(`laporan-kas-${month}01_${today()}.xlsx`);
  const file = await readFile((await download.path())!);
  expect(file.subarray(0, 2).toString()).toBe("PK");
  expect(file.byteLength).toBeGreaterThan(4_000);
});
