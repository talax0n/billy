import { type Browser, expect, type Page, test } from "@playwright/test";
import { ADMIN, docNumber, KASIR, login } from "../helpers.ts";

const PIN = "135790";

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

const draftsDialog = async (page: Page) => {
  await page.getByRole("button", { name: /^Nota sementara/ }).first().click();
  return page.getByRole("dialog", { name: "Nota sementara" });
};

async function saveDraft(page: Page, number: string) {
  await addThinner(page);
  await (await draftsDialog(page)).getByRole("button", { name: "Simpan sebagai nota sementara" }).click();
  await expect(page.getByText(`Disimpan sebagai nota sementara ${number}`)).toBeVisible();
  await expect(page.getByText("Keranjang kosong")).toBeVisible();
}

test("a nota sementara is saved on one device, printed, opened and paid on another", async ({ browser }) => {
  const kasir = await atKasir(browser, KASIR);
  const first = docNumber("S", 1);
  await saveDraft(kasir, first);
  await expect(kasir.getByRole("button", { name: /^Nota sementara/ }).first()).toHaveText("Nota sementara1");

  let dialog = await draftsDialog(kasir);
  await dialog.getByRole("button", { name: `Cetak ${first}` }).click();
  await expect(kasir.getByTestId("receipt")).toContainText("NOTA SEMENTARA");
  await expect(kasir.getByTestId("receipt")).toContainText("BUKAN BUKTI PEMBAYARAN");
  await expect(dialog.getByText("Dicetak 1×")).toBeVisible();
  await kasir.keyboard.press("Escape");

  const admin = await atKasir(browser, ADMIN);
  dialog = await draftsDialog(admin);
  await dialog.getByRole("button", { name: `Buka ${first}` }).click();
  await expect(admin.getByText(`Nota sementara ${first}`)).toBeVisible();
  await expect(admin.getByTestId("pos-total")).toContainText("32.000");
  await admin.getByRole("button", { name: "Uang pas" }).click();
  await admin.getByRole("button", { name: /Bayar & cetak struk/ }).click();
  await expect(admin.getByText("Keranjang kosong")).toBeVisible();
  await expect(admin.getByRole("button", { name: /^Nota sementara/ }).first()).toHaveText("Nota sementara");

  await admin.goto("/riwayat-kasir");
  await admin.getByRole("row").nth(1).click();
  await expect(admin.getByText(`Dari nota sementara ${first}`)).toBeVisible();
  await admin.context().close();
  await kasir.context().close();
});

test("cancelling a printed nota sementara needs the admin", async ({ browser }) => {
  const kasir = await atKasir(browser, KASIR);
  const printed = docNumber("S", 2);
  await saveDraft(kasir, printed);
  let dialog = await draftsDialog(kasir);
  await dialog.getByRole("button", { name: `Cetak ${printed}` }).click();
  await expect(dialog.getByText("Dicetak 1×")).toBeVisible();
  await dialog.getByRole("button", { name: `Batalkan ${printed}` }).click();
  const cancel = kasir.getByRole("dialog", { name: `Batalkan ${printed}` });
  await cancel.getByLabel("Alasan").fill("Pelanggan tidak jadi");
  await cancel.getByRole("button", { name: "Batalkan nota" }).click();
  const approval = kasir.getByRole("dialog", { name: "Butuh persetujuan admin" });
  await expect(approval).toContainText("Nota sementara yang sudah dicetak hanya bisa dibatalkan dengan persetujuan admin.");
  await approval.getByLabel("PIN admin").fill(PIN);
  await approval.getByRole("button", { name: "Setujui dengan PIN" }).click();
  await expect(kasir.getByText(`${printed} dibatalkan`)).toBeVisible();
  await expect(dialog.getByRole("button", { name: `Batalkan ${printed}` })).toHaveCount(0);
  await kasir.keyboard.press("Escape");

  const open = docNumber("S", 3);
  await saveDraft(kasir, open);
  await kasir.context().close();
});
