import { type Browser, expect, type Page, test } from "@playwright/test";
import { ADMIN, KASIR, login, openShift, rp } from "../helpers.ts";

async function signedIn(browser: Browser, user: typeof ADMIN) {
  const page = await (await browser.newContext()).newPage();
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

test("a shift short of cash is a red flag on the Overview and in Ringkasan harian", async ({ browser }) => {
  const kasir = await signedIn(browser, KASIR);
  const open = kasir.getByRole("dialog", { name: "Buka shift" });
  await expect(open.or(kasir.getByRole("button", { name: /Shift sejak/ }))).toBeVisible();
  if (!(await open.isVisible())) await closeShift(kasir, 0);
  await openShift(kasir, 100_000);
  await expect(kasir.getByTestId("sync-state")).toHaveText("Online");
  await closeShift(kasir, 63_000);
  await expect(kasir.getByTestId("sync-pending")).toHaveText("");
  expect((await kasir.request.get("/api/watchdog?from=2026-01-01&to=2026-01-02")).status()).toBe(403);
  await kasir.context().close();

  const flag = `Selisih kas shift K1 −${rp(37_000)}: seharusnya ${rp(100_000)}, dihitung ${rp(63_000)}`;
  const admin = await signedIn(browser, ADMIN);
  await admin.goto("/");
  const card = admin.getByRole("region", { name: "Peringatan" });
  await expect(card.getByRole("link", { name: new RegExp(flag) })).toBeVisible();
  await card.getByRole("link", { name: /dalam 7 hari/ }).click();

  await expect(admin).toHaveURL(/\/ringkasan-harian$/);
  await expect(admin.getByRole("region", { name: "Peringatan" }).getByRole("link", { name: new RegExp(flag) })).toBeVisible();
  await expect(admin.getByRole("row", { name: /^Kasir Satu Kasir/ })).toBeVisible();

  await admin.getByRole("region", { name: "Peringatan" }).getByRole("link", { name: new RegExp(flag) }).click();
  await expect(admin).toHaveURL(/\/log-aktivitas\?/);
  await expect(admin.getByRole("row", { name: new RegExp(`Tutup shift K1 · selisih −${rp(37_000)}`) })).toBeVisible();
  await admin.context().close();
});

test("an opname is counted, saved, posted, and the stock follows the count", async ({ browser }) => {
  const admin = await signedIn(browser, ADMIN);
  await admin.goto("/stok-opname");
  await admin.getByRole("button", { name: "Opname baru" }).click();
  const create = admin.getByRole("dialog", { name: "Opname baru" });
  await create.getByLabel("Barang yang dihitung").selectOption({ label: "Kategori Alat Cat" });
  await create.getByRole("button", { name: "Mulai opname" }).click();
  await expect(admin.getByRole("heading", { name: /^Opname OP-\d{6}-\d{4}$/ })).toBeVisible();
  await expect(admin.getByText("Stok sistem diambil saat posting")).toBeVisible();

  await admin.getByPlaceholder("Cari nama, kode atau barcode…").fill("amplas");
  const input = admin.getByRole("textbox", { name: "Jumlah dihitung Amplas Kertas No. 240" });
  await input.fill("150");
  await admin.getByRole("button", { name: "Simpan hitungan (1)" }).click();
  await expect(admin.getByText("Hitungan disimpan")).toBeVisible();

  await admin.getByRole("button", { name: "Posting", exact: true }).click();
  await admin.getByRole("dialog", { name: "Posting opname?" }).getByRole("button", { name: "Posting sekarang" }).click();
  await expect(admin.getByText(/diposting · 1 barang disesuaikan/)).toBeVisible();
  await expect(admin.getByText(/Opname ini tidak bisa diubah lagi/)).toBeVisible();
  await expect(admin.getByRole("textbox", { name: "Jumlah dihitung Amplas Kertas No. 240" })).toHaveCount(0);

  const products = (await (await admin.request.get("/api/products?q=AL-003")).json()) as { rows: { code: string; stock: number }[] };
  expect(products.rows.find((p) => p.code === "AL-003")?.stock).toBe(150);

  await admin.goto("/mutasi-stok");
  await expect(admin.getByRole("row", { name: /Amplas Kertas.*Penyesuaian/ }).first()).toBeVisible();
  await admin.context().close();
});
