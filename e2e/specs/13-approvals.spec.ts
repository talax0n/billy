import { type Browser, expect, type Page, test } from "@playwright/test";
import { ADMIN, docNumber, KASIR, login, rp } from "../helpers.ts";

const PIN = "135790";
const search = (page: Page) => page.getByLabel("Cari produk atau scan barcode");

async function signedIn(browser: Browser, user: typeof ADMIN) {
  const context = await browser.newContext();
  const page = await context.newPage();
  // The receipt prints through window.print(); headless has no printer to talk to.
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await login(page, user);
  return page;
}

/** One Kilau Enamel Hitam (Rp 78.000) with a transaction discount, then Bayar. */
async function sellWithDiscount(kasir: Page, percent: string) {
  await search(kasir).fill("kilau enamel hitam");
  await expect(kasir.getByRole("listbox", { name: "Hasil pencarian" }).getByRole("option").first()).toContainText("Kilau Enamel Hitam 1 L");
  await search(kasir).press("Enter");
  await kasir.keyboard.press("F4");
  const discount = kasir.getByRole("dialog", { name: "Diskon transaksi" });
  await discount.getByLabel("Diskon (%)").fill(percent);
  await discount.getByRole("button", { name: "Simpan diskon" }).click();
  await kasir.getByRole("button", { name: /Bayar & cetak struk/ }).click();
}

test("a kasir discount over 5% needs the admin: by PIN at the counter, or approved from the bell", async ({ browser }) => {
  const admin = await signedIn(browser, ADMIN);
  await admin.goto("/pengaturan");
  await admin.getByRole("tab", { name: "Keamanan" }).click();
  await expect(admin.getByLabel("Diskon maksimal per nota (%)")).toHaveValue("5");
  await admin.getByLabel("PIN baru (6 angka)").fill(PIN);
  await admin.getByLabel("Kata sandi Anda").fill(ADMIN.password);
  await admin.getByRole("button", { name: "Simpan PIN" }).click();
  await expect(admin.getByText("PIN persetujuan disimpan")).toBeVisible();

  const kasir = await signedIn(browser, KASIR);
  await expect(kasir).toHaveURL(/\/kasir$/);
  await expect(kasir.getByTestId("sync-state")).toHaveText("Online");

  // PIN typed at the counter.
  await sellWithDiscount(kasir, "10");
  const approval = kasir.getByRole("dialog", { name: "Butuh persetujuan admin" });
  await expect(approval).toContainText("Diskon 10% melebihi batas kasir 5% per nota.");
  await approval.getByLabel("PIN admin").fill("000000");
  await approval.getByRole("button", { name: "Setujui dengan PIN" }).click();
  await expect(approval).toContainText("PIN admin salah. Sisa 4 percobaan.");
  await approval.getByLabel("PIN admin").fill(PIN);
  await approval.getByRole("button", { name: "Setujui dengan PIN" }).click();
  await expect(approval).toBeHidden();
  await expect(kasir.getByText("Keranjang kosong")).toBeVisible();
  await expect(kasir.getByTestId("sync-pending")).toHaveText("");

  // Remote: the kasir asks, the admin approves from the bell, the sale continues by itself.
  await sellWithDiscount(kasir, "8");
  await approval.getByRole("button", { name: "Minta persetujuan" }).click();
  await expect(approval.getByText("Menunggu persetujuan admin…")).toBeVisible();

  const remoteNumber = docNumber("K1", 4);
  await admin.goto("/log-aktivitas");
  await admin.getByRole("button", { name: /Perlu tindakan: \d+/ }).click();
  const approve = admin.getByRole("button", { name: `Setujui Diskon 8% · ${remoteNumber} · ${rp(71_760)}` });
  await approve.click();
  await expect(approve).toBeHidden();

  await expect(approval).toBeHidden({ timeout: 15_000 });
  await expect(kasir.getByText("Keranjang kosong")).toBeVisible();
  await expect(kasir.getByTestId("sync-pending")).toHaveText("");

  // Both sales are in Log Aktivitas with the approval behind them.
  await admin.reload();
  await admin.getByLabel("Aksi").selectOption({ label: "Penjualan kasir" });
  const pinSale = admin.getByRole("row", { name: new RegExp(`Penjualan ${docNumber("K1", 3)} ${rp(70_200)}.*Disetujui`) });
  await expect(pinSale).toBeVisible();
  await expect(admin.getByRole("row", { name: new RegExp(`Penjualan ${remoteNumber} ${rp(71_760)}.*Disetujui`) })).toBeVisible();
  await pinSale.click();
  const detail = admin.getByRole("dialog", { name: "Penjualan kasir" });
  await expect(detail).toContainText("Diskon di atas batas · PIN oleh Pemilik");
  await expect(detail).toContainText("discountBp");

  await admin.context().close();
  await kasir.context().close();
});

test("offline, a discount over the cap is blocked because approval needs internet", async ({ browser }) => {
  const kasir = await signedIn(browser, KASIR);
  await expect(kasir.getByTestId("sync-state")).toHaveText("Online");
  await kasir.context().setOffline(true);
  await expect(kasir.getByTestId("sync-state")).toHaveText("Offline");
  await sellWithDiscount(kasir, "10");
  const approval = kasir.getByRole("dialog", { name: "Butuh persetujuan admin" });
  await expect(approval).toContainText("Persetujuan admin butuh internet");
  await expect(approval.getByLabel("PIN admin")).toHaveCount(0);
  await kasir.keyboard.press("Escape");
  await expect(approval).toBeHidden();
  await expect(kasir.getByTestId("sync-pending")).toHaveText("");
  await kasir.context().close();
});
