import { type Browser, expect, test } from "@playwright/test";
import { ADMIN, login } from "../helpers.ts";

async function signedIn(browser: Browser, user: typeof ADMIN) {
  const page = await (await browser.newContext()).newPage();
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await login(page, user);
  return page;
}

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
