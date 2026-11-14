import { type Browser, expect, type Page, test } from "@playwright/test";
import { ADMIN, KASIR, login, openShift, rp } from "../helpers.ts";

async function signedIn(browser: Browser, user: typeof ADMIN) {
  const page = await (await browser.newContext()).newPage();
  // The receipt prints through window.print(); headless has no printer to talk to.
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await login(page, user);
  return page;
}

async function closeShift(kasir: Page, counted: number) {
  await kasir.getByRole("button", { name: /Shift sejak/ }).click();
  const dialog = kasir.getByRole("dialog", { name: "Tutup shift" });
  await dialog.getByLabel("Uang tunai di laci").fill(String(counted));
  await dialog.getByRole("button", { name: "Tutup shift" }).click();
  await expect(kasir.getByText("Shift ditutup")).toBeVisible();
  await expect(kasir.getByRole("dialog", { name: "Buka shift" })).toBeVisible();
}

test("a kasir opens a shift, sells in cash and closes blind; the admin sees the difference", async ({ browser }) => {
  const kasir = await signedIn(browser, KASIR);
  await expect(kasir).toHaveURL(/\/kasir$/);
  // The shift left open by the earlier Kasir specs.
  await closeShift(kasir, 0);

  await openShift(kasir, 100_000);
  await kasir.getByLabel("Cari produk atau scan barcode").fill("thinner super 1");
  await expect(kasir.getByRole("listbox", { name: "Hasil pencarian" }).getByRole("option").first()).toContainText("Thinner Super 1 L");
  await kasir.getByLabel("Cari produk atau scan barcode").press("Enter");
  await kasir.getByRole("button", { name: "Uang pas" }).click();
  await kasir.getByRole("button", { name: /Bayar & cetak struk/ }).click();
  await expect(kasir.getByText("Keranjang kosong")).toBeVisible();
  await expect(kasir.getByTestId("sync-pending")).toHaveText("");

  // 100.000 float + 32.000 cash sale = 132.000 expected; the kasir counts 112.000.
  await closeShift(kasir, 112_000);
  await expect(kasir.getByTestId("sync-pending")).toHaveText("");
  await expect(kasir.locator("body")).not.toContainText(rp(132_000));
  expect((await kasir.request.get("/api/audit")).status()).toBe(403);
  await kasir.context().close();

  const admin = await signedIn(browser, ADMIN);
  await admin.goto("/log-aktivitas");
  await admin.getByLabel("Aksi").selectOption({ label: "Tutup shift" });
  const closed = admin.getByRole("row", { name: new RegExp(`Tutup shift K1 · selisih −${rp(20_000)}`) });
  await expect(closed).toBeVisible();
  await closed.click();
  const detail = admin.getByRole("dialog", { name: "Tutup shift" });
  await expect(detail).toContainText("expectedCash");
  await expect(detail).toContainText("132000");
  await admin.context().close();
});

test("offline, a shift opens, sells and closes on the device, then syncs in order", async ({ browser }) => {
  const kasir = await signedIn(browser, KASIR);
  await expect(kasir.getByRole("dialog", { name: "Buka shift" })).toBeVisible();
  await kasir.context().setOffline(true);
  await expect(kasir.getByTestId("sync-state")).toHaveText("Offline");

  await openShift(kasir, 50_000);
  await kasir.getByLabel("Cari produk atau scan barcode").fill("thinner super 1");
  await kasir.getByLabel("Cari produk atau scan barcode").press("Enter");
  await kasir.getByRole("button", { name: "Uang pas" }).click();
  await kasir.getByRole("button", { name: /Bayar & cetak struk/ }).click();
  await expect(kasir.getByText("Keranjang kosong")).toBeVisible();
  await closeShift(kasir, 82_000);
  await expect(kasir.getByTestId("sync-pending")).toHaveText(" · 3 transaksi menunggu sinkron");

  await kasir.context().setOffline(false);
  await expect(kasir.getByTestId("sync-pending")).toHaveText("", { timeout: 30_000 });
  await expect(kasir.getByRole("button", { name: /masalah sinkron/ })).toHaveCount(0);
  await kasir.context().close();

  const admin = await signedIn(browser, ADMIN);
  await admin.goto("/log-aktivitas");
  await admin.getByLabel("Aksi").selectOption({ label: "Tutup shift" });
  await expect(admin.getByRole("row", { name: new RegExp(`Tutup shift K1 · selisih ${rp(0)}`) }).first()).toBeVisible();
  await admin.context().close();
});
