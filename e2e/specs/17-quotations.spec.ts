import { type Browser, expect, type Page, test } from "@playwright/test";
import { ADMIN, docNumber, login } from "../helpers.ts";

const PIN = "135790";
const STAFF = { username: "staf1", password: "staf12345" };

async function signedIn(browser: Browser, user: { username: string; password: string }) {
  const page = await (await browser.newContext()).newPage();
  await login(page, user);
  return page;
}

const invoiceCount = async (page: Page) => {
  await page.goto("/penjualan");
  return (await page.getByText(/^\d+ faktur$/).textContent()) ?? "";
};

test("a quotation moves no sales until staff converts it, which needs the admin for a low price", async ({ browser }) => {
  const number = docNumber("Q", 1);
  const admin = await signedIn(browser, ADMIN);
  const created = await admin.request.post("/api/users", {
    data: { username: STAFF.username, name: "Staf Satu", role: "staff", password: STAFF.password },
  });
  expect(created.ok()).toBe(true);
  const invoicesBefore = await invoiceCount(admin);

  const staff = await signedIn(browser, STAFF);
  await staff.goto("/penawaran");
  await staff.getByRole("button", { name: "Penawaran baru" }).click();
  const form = staff.getByRole("dialog", { name: "Penawaran harga baru" });
  await expect(form.getByLabel("Berlaku sampai")).toBeVisible();
  await expect(form.getByLabel("Tempo (hari)")).toHaveCount(0);
  await expect(form.getByText("Bayar sekarang")).toHaveCount(0);
  await form.getByPlaceholder("Cari pelanggan…").fill("uji");
  await form.getByRole("option", { name: /CV Uji Pelanggan/ }).click();
  await form.getByPlaceholder("Ketik nama barang…").fill("warnaku putih 5");
  await expect(form.getByRole("listbox").getByRole("option").first()).toContainText("Warnaku Tembok Putih 5 kg");
  await form.getByPlaceholder("Ketik nama barang…").press("Enter");
  await form.getByLabel("Jumlah baris 1").fill("2");
  await form.getByLabel("Harga baris 1").fill("150000");
  await form.getByRole("button", { name: "Simpan penawaran" }).click();

  const sheet = staff.getByRole("dialog", { name: number });
  await expect(sheet.getByText("Draf")).toBeVisible();
  await expect(staff).toHaveURL(/\/penawaran\?id=/);
  const id = new URL(staff.url()).searchParams.get("id");

  const [print] = await Promise.all([staff.waitForEvent("popup"), sheet.getByRole("button", { name: "Cetak penawaran" }).click()]);
  await expect(print.getByText("PENAWARAN HARGA")).toBeVisible();
  await expect(print.getByText("Bukan tagihan")).toBeVisible();
  await expect(print.getByText(number)).toBeVisible();
  await print.close();

  await sheet.getByRole("button", { name: "Tutup" }).click();
  await expect(staff.getByRole("row", { name: new RegExp(`${number} CV Uji Pelanggan.*Draf`) })).toBeVisible();
  expect(await invoiceCount(admin)).toBe(invoicesBefore);

  const refused = await staff.request.post(`/api/quotations/${id}/convert`, { data: { date: new Date().toISOString().slice(0, 10), termsDays: 0 } });
  expect(refused.status()).toBe(403);
  expect((await refused.json()).approval).toBeDefined();

  await staff.goto(`/penawaran?id=${id}`);
  await sheet.getByRole("button", { name: "Jadikan faktur" }).click();
  await staff.getByRole("dialog", { name: "Jadikan faktur" }).getByRole("button", { name: "Jadikan faktur" }).click();
  const approval = staff.getByRole("dialog", { name: "Butuh persetujuan admin" });
  await approval.getByLabel("PIN admin").fill(PIN);
  await approval.getByRole("button", { name: "Setujui dengan PIN" }).click();

  await expect(staff).toHaveURL(/\/penjualan\?id=/);
  const invoice = staff.getByRole("dialog", { name: /^SO-\d{6}-\d{4}$/ });
  await expect(invoice.getByRole("link", { name: `Dari penawaran ${number}` })).toBeVisible();
  await expect(invoice.getByText("Belum bayar")).toBeVisible();

  await invoice.getByRole("link", { name: `Dari penawaran ${number}` }).click();
  await expect(staff.getByRole("dialog", { name: number }).getByText("Diterima")).toBeVisible();
  await expect(staff.getByRole("dialog", { name: number }).getByRole("link", { name: /^Faktur SO-/ })).toBeVisible();
  expect(await invoiceCount(admin)).not.toBe(invoicesBefore);
});
