import { expect, test } from "@playwright/test";
import { ADMIN, KASIR, login, openShift, rp } from "../helpers.ts";

const daysAgo = (days: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() - days * 86_400_000));

test("Penjualan puts overdue invoices first, counts each status chip and links the late-payment notice", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/penjualan");

  // 45 days ago on 30 days terms: 15 days late, and outside this month's period.
  await page.getByRole("button", { name: "Faktur baru" }).click();
  const form = page.getByRole("dialog", { name: "Faktur penjualan baru" });
  await form.getByPlaceholder("Cari pelanggan…").fill("uji");
  await form.getByRole("option", { name: /CV Uji Pelanggan/ }).click();
  await form.getByLabel("Tanggal").fill(daysAgo(45));
  await form.getByLabel("Tempo (hari)").fill("30");
  const picker = form.getByPlaceholder("Ketik nama barang…").last();
  await picker.fill("thinner super 1");
  await expect(form.getByRole("listbox").getByRole("option").first()).toContainText("Thinner Super 1 L");
  await picker.press("Enter");
  await form.getByLabel("Jumlah baris 1").fill("2");
  await form.getByRole("button", { name: "Simpan faktur" }).click();
  const sheet = page.getByRole("dialog", { name: /^SO-\d{6}-\d{4}$/ });
  await expect(sheet.getByText("Telat")).toBeVisible();
  const late = (await sheet.getByRole("heading").first().textContent())!.trim();
  await sheet.getByRole("button", { name: "Tutup" }).click();

  const notice = page.getByRole("alert").filter({ hasText: "faktur telat bayar" });
  await expect(notice).toContainText(`1 faktur telat bayar · total ${rp(64_000)}`);
  await expect(page.getByRole("link", { name: /^Penjualan/ }).getByTitle("1 perlu dicek")).toHaveText("1");
  const chips = page.getByRole("group", { name: "Status faktur" });
  await expect(chips.getByRole("button", { name: /^Telat bayar/ })).toHaveText("Telat bayar0");
  await page.screenshot({ path: "test-results/penjualan-banner.png", fullPage: true });

  await notice.getByRole("button", { name: "Lihat faktur telat" }).click();
  await expect(chips.getByRole("button", { name: /^Telat bayar/ })).toHaveAttribute("aria-pressed", "true");
  await expect(chips.getByRole("button", { name: /^Telat bayar/ })).toHaveText("Telat bayar1");
  const rows = page.getByRole("row").filter({ has: page.getByText(/^SO-/) });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(late);
  await expect(rows.first()).toContainText("Telat");

  // Semua, all time: the late one leads, then open ones, then Lunas, Void last.
  await chips.getByRole("button", { name: /^Semua/ }).click();
  await expect(rows.first()).toContainText(late);
  const tags = await rows.evaluateAll((trs) => trs.map((tr) => tr.lastElementChild!.textContent!.trim()));
  const rank = { Telat: 0, "Belum bayar": 1, Sebagian: 1, Lunas: 2, Void: 3 } as Record<string, number>;
  expect(tags.map((t) => rank[t])).toEqual([...tags.map((t) => rank[t])].sort());
  await page.screenshot({ path: "test-results/penjualan-chips.png", fullPage: true });

  await chips.getByRole("button", { name: /^Lunas/ }).click();
  await expect(rows.first()).toContainText("Lunas");
  expect(new Set(await rows.evaluateAll((trs) => trs.map((tr) => tr.lastElementChild!.textContent!.trim())))).toEqual(new Set(["Lunas"]));
});

test("kasir types the tinting machine price with H, the line keeps its own row and prints at that price", async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await login(page, KASIR);
  await page.goto("/kasir");
  const open = page.getByRole("dialog", { name: "Buka shift" });
  await expect(open.or(page.getByRole("button", { name: /Shift sejak/ }))).toBeVisible();
  if (await open.isVisible()) await openShift(page, 0);
  await expect(page.getByTestId("sync-state")).toHaveText("Online");

  const search = page.getByLabel("Cari produk atau scan barcode");
  const addEnamel = async () => {
    await search.fill("kilau enamel putih");
    await expect(page.getByRole("listbox", { name: "Hasil pencarian" }).getByRole("option").first()).toContainText("Kilau Enamel Putih 1 L");
    await search.press("Enter");
  };
  await addEnamel();
  await expect(page.getByRole("button", { name: "Ubah harga H" })).toBeVisible();
  await search.press("ArrowUp");
  await search.press("h");

  const dialog = page.getByRole("dialog", { name: "Ubah harga (harga mesin)" });
  await expect(dialog.getByText("Masukkan harga dari mesin tinting")).toBeVisible();
  await expect(dialog.getByLabel("Harga per item")).toHaveValue("78.000");
  await dialog.getByLabel("Harga per item").fill("245500");
  await dialog.getByLabel("Kode warna tinting (boleh kosong)").fill("NW-1023 Hijau Daun");
  await page.screenshot({ path: "test-results/kasir-harga-dialog.png" });
  await dialog.getByRole("button", { name: "Simpan harga" }).click();

  const lines = page.getByRole("row").filter({ hasText: "Kilau Enamel Putih" });
  await expect(lines.first()).toContainText("Harga mesin");
  await expect(lines.first()).toContainText("245.500");
  await expect(lines.first().getByLabel("Harga katalog")).toContainText("78.000");

  // Re-adding the product starts a plain line instead of joining the tinted one.
  await addEnamel();
  await expect(lines).toHaveCount(2);
  await page.screenshot({ path: "test-results/kasir-harga-mesin.png" });
  await search.press("Delete");
  await expect(lines).toHaveCount(1);

  await page.getByRole("button", { name: "Uang pas" }).click();
  await page.getByRole("button", { name: /Bayar & cetak struk/ }).click();
  await expect(page.getByText("Keranjang kosong")).toBeVisible();
  const receipt = page.getByTestId("receipt");
  await expect(receipt).toContainText(/1 \w+ × .*245\.500/);
  await expect(receipt).toContainText("NW-1023 Hijau Daun");
  await expect(receipt).toContainText("Cat tinting tidak bisa diretur");
});
