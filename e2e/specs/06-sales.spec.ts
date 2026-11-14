import { expect, type Locator, type Page, test } from "@playwright/test";
import { ADMIN, docNumber, login, rp } from "../helpers.ts";

const num = (value: number) => value.toLocaleString("id-ID");

/** Picks a product in the next empty line of the invoice form and types its quantity. */
async function addLine(form: Locator, line: number, search: string, product: string, qty: string) {
  const picker = form.getByPlaceholder("Ketik nama barang…").last();
  await picker.fill(search);
  await expect(form.getByRole("listbox").getByRole("option").first()).toContainText(product);
  await picker.press("Enter");
  const qtyInput = form.getByLabel(`Jumlah baris ${line}`);
  await expect(qtyInput).toBeFocused();
  await qtyInput.fill(qty);
  await qtyInput.press("Enter");
}

async function newInvoice(page: Page, lines: [search: string, product: string, qty: string][]) {
  await page.getByRole("button", { name: "Faktur baru" }).click();
  const form = page.getByRole("dialog", { name: "Faktur penjualan baru" });
  await form.getByPlaceholder("Cari pelanggan…").fill("uji");
  await form.getByRole("option", { name: /CV Uji Pelanggan/ }).click();
  for (const [i, [search, product, qty]] of lines.entries()) await addLine(form, i + 1, search, product, qty);
  return form;
}

test("sells on an invoice, takes a partial and a final payment, prints it", async ({ page }) => {
  const number = docNumber("SO", 1);
  await login(page, ADMIN);
  await page.goto("/penjualan");

  const form = await newInvoice(page, [
    ["warnaku putih 5", "Warnaku Tembok Putih 5 kg", "2"],
    ["thinner super 1", "Thinner Super 1 L", "3"],
  ]);
  const totals = form.getByRole("complementary", { name: "Total" });
  await expect(totals).toContainText(`Subtotal${rp(466_000)}`);
  await expect(totals).toContainText(`Total${rp(466_000)}`);
  await form.getByRole("button", { name: "Simpan faktur" }).click();

  const sheet = page.getByRole("dialog", { name: number });
  await expect(sheet.getByText("Belum bayar")).toBeVisible();
  await expect(page).toHaveURL(/\/penjualan\?id=/);

  await sheet.getByRole("button", { name: "Catat pembayaran" }).click();
  let pay = page.getByRole("dialog", { name: "Catat pembayaran" });
  await pay.getByLabel("Masuk ke akun").selectOption({ label: "BCA Operasional" });
  await pay.getByLabel("Jumlah").fill("200000");
  await pay.getByRole("button", { name: "Simpan pembayaran" }).click();
  await expect(sheet.getByText("Sebagian")).toBeVisible();
  await expect(sheet.getByText(`Sisa${rp(266_000)}`)).toBeVisible();

  await sheet.getByRole("button", { name: "Catat pembayaran" }).click();
  pay = page.getByRole("dialog", { name: "Catat pembayaran" });
  await pay.getByLabel("Masuk ke akun").selectOption({ label: "Kas Toko" });
  await pay.getByLabel("Jumlah").fill("300000");
  await pay.getByRole("button", { name: "Simpan pembayaran" }).click();
  await expect(pay.getByText(`Pembayaran melebihi sisa tagihan ${rp(266_000)}`)).toBeVisible();

  await pay.getByLabel("Jumlah").fill("266000");
  await pay.getByRole("button", { name: "Simpan pembayaran" }).click();
  await expect(sheet.getByText("Lunas")).toBeVisible();
  await expect(sheet.getByText(`Terbayar${rp(466_000)}`)).toBeVisible();
  await expect(sheet.getByText(`Sisa${rp(0)}`)).toBeVisible();

  await page.context().addInitScript(() => {
    window.print = () => {
      document.documentElement.dataset.printed = String(Number(document.documentElement.dataset.printed ?? 0) + 1);
    };
  });
  const [print] = await Promise.all([page.waitForEvent("popup"), sheet.getByRole("button", { name: "Cetak faktur" }).click()]);
  await expect(print.locator("html"), "the faktur prints on open, once").toHaveAttribute("data-printed", "1");
  await expect(print.getByRole("heading", { name: "Faktur" })).toBeVisible();
  await expect(print.getByText(number)).toBeVisible();
  await expect(print.getByText("CV Uji Pelanggan")).toBeVisible();
  await expect(print.getByRole("row", { name: /Thinner Super 1 L\s+3 botol/ })).toContainText(num(96_000));
  await expect(print.getByText(`Rp. ${num(466_000)}`)).toBeVisible();

  const pdf = (await print.pdf({ format: "A4", path: process.env.E2E_PDF_OUT })).toString("latin1");
  expect(pdf.match(/\/Type\s*\/Page\b/g)?.length, "a short faktur takes one page").toBe(1);
  await print.close();
});

test("leaves a second invoice open for tukar faktur", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/penjualan");
  const form = await newInvoice(page, [["enamel merah", "Kilau Enamel Merah 1 L", "2"]]);
  await form.getByRole("button", { name: "Simpan faktur" }).click();
  await expect(page.getByRole("dialog", { name: docNumber("SO", 2) }).getByText("Belum bayar")).toBeVisible();
  await page.getByRole("dialog", { name: docNumber("SO", 2) }).getByRole("button", { name: "Tutup" }).click();

  await page.getByRole("group", { name: "Status faktur" }).getByRole("button", { name: /^Lunas/ }).click();
  await expect(page.getByRole("row", { name: new RegExp(docNumber("SO", 1)) })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(docNumber("SO", 2)) })).toBeHidden();
});
