import { expect, type Page, test } from "@playwright/test";
import { ADMIN, KASIR, login, openShift, rp } from "../helpers.ts";

const PIN = "135790";

async function addThinner(page: Page) {
  const search = page.getByLabel("Cari produk atau scan barcode");
  await search.fill("thinner super 1");
  await expect(page.getByRole("listbox", { name: "Hasil pencarian" }).getByRole("option").first()).toContainText("Thinner Super 1 L");
  await search.press("Enter");
}

const nextNumber = async (page: Page) => (await page.getByRole("banner").getByText(/^K1-\d{6}-\d{4}$/).textContent())!;

async function startRevisi(page: Page, number: string, reason: string) {
  await page.keyboard.press("F9");
  const history = page.getByRole("dialog", { name: "Riwayat kasir" });
  await history.getByRole("button", { name: `Revisi ${number}` }).click();
  const dialog = page.getByRole("dialog", { name: `Revisi ${number}` });
  await dialog.getByLabel("Alasan revisi").fill(reason);
  await dialog.getByRole("button", { name: "Mulai revisi" }).click();
  await expect(page.getByRole("button", { name: `Revisi ${number} · batal` })).toBeVisible();
}

test("a paid nota is revised up and down; the drawer and the shift report stay true", async ({ browser }) => {
  const kasir = await (await browser.newContext()).newPage();
  await kasir.addInitScript(() => {
    window.print = () => {};
  });
  await login(kasir, KASIR);
  await openShift(kasir, 100_000);
  await expect(kasir.getByTestId("sync-state")).toHaveText("Online");

  const original = await nextNumber(kasir);
  await addThinner(kasir);
  await kasir.getByRole("button", { name: "Uang pas" }).click();
  await kasir.getByRole("button", { name: /Bayar & cetak struk/ }).click();
  await expect(kasir.getByText("Keranjang kosong")).toBeVisible();

  // Up: one more thinner, the customer pays the 32.000 difference.
  const higher = await nextNumber(kasir);
  await startRevisi(kasir, original, "Tambah satu");
  await addThinner(kasir);
  await expect(kasir.getByTestId("pos-difference")).toContainText("Selisih dibayar");
  await expect(kasir.getByTestId("pos-difference")).toContainText("32.000");
  await kasir.getByRole("button", { name: "Uang pas" }).click();
  await kasir.getByRole("button", { name: /Simpan revisi & cetak struk/ }).click();
  await expect(kasir.getByText("Keranjang kosong")).toBeVisible();
  await expect(kasir.getByTestId("receipt")).toContainText(`Revisi dari ${original}`);

  // Down: back to one, 32.000 refunded from the drawer with the admin's PIN.
  const lower = await nextNumber(kasir);
  await startRevisi(kasir, higher, "Batal satu");
  await kasir.getByLabel("Cari produk atau scan barcode").press("-");
  await expect(kasir.getByTestId("pos-difference")).toContainText("Dikembalikan tunai dari laci");
  await kasir.getByRole("button", { name: /Simpan revisi & cetak struk/ }).click();
  const approval = kasir.getByRole("dialog", { name: "Butuh persetujuan admin" });
  await expect(approval).toContainText("Revisi yang menurunkan total butuh persetujuan admin.");
  await approval.getByLabel("PIN admin").fill(PIN);
  await approval.getByRole("button", { name: "Setujui dengan PIN" }).click();
  await expect(kasir.getByText("Keranjang kosong")).toBeVisible();

  await kasir.keyboard.press("F9");
  const history = kasir.getByRole("dialog", { name: "Riwayat kasir" });
  await expect(history.getByText(`revisi dari ${higher}`)).toBeVisible();
  await expect(history.getByText("Direvisi")).toHaveCount(2);
  await history.getByRole("button", { name: "Cetak ulang" }).first().click();
  await expect(kasir.getByTestId("receipt")).toContainText("SALINAN");
  await kasir.keyboard.press("Escape");

  // 100.000 float + 32.000 + 32.000 − 32.000.
  await kasir.getByRole("button", { name: /Shift sejak/ }).click();
  const close = kasir.getByRole("dialog", { name: "Tutup shift" });
  await close.getByLabel("Uang tunai di laci").fill("132000");
  await close.getByRole("button", { name: "Tutup shift" }).click();
  await expect(kasir.getByText("Shift ditutup")).toBeVisible();
  await expect(kasir.getByTestId("sync-pending")).toHaveText("");
  await kasir.context().close();

  const admin = await (await browser.newContext()).newPage();
  await login(admin, ADMIN);
  await admin.goto("/laporan-shift");
  await expect(admin.getByRole("row", { name: new RegExp(`Kasir Satu.*K1 · Kas Toko.*${rp(100_000)}.*${rp(132_000)}.*${rp(132_000)}.*Rp 0`) })).toBeVisible();
  await admin.goto("/riwayat-kasir");
  await expect(admin.getByRole("row", { name: new RegExp(`${original}.*Direvisi`) })).toBeVisible();
  await expect(admin.getByRole("row", { name: new RegExp(`${lower}.*revisi dari ${higher}`) })).toBeVisible();
  await admin.goto("/log-aktivitas");
  await admin.getByLabel("Aksi").selectOption({ label: "Revisi struk kasir" });
  await expect(admin.getByRole("row", { name: new RegExp(`Revisi ${higher} → ${lower}`) })).toBeVisible();
  await admin.context().close();
});
