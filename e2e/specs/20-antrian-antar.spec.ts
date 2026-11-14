import { type Browser, expect, type Page, test } from "@playwright/test";
import { ADMIN, login } from "../helpers.ts";

const KASIR_ANTAR = { username: "kasirantar", password: "kasir12345" };
const shots = process.env.E2E_SCREENSHOTS;
const shot = (page: Page, name: string) => (shots ? page.screenshot({ path: `${shots}/${name}.png` }) : Promise.resolve());

async function fresh(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await page.addInitScript(() => {
    window.print = () => {};
  });
  return page;
}

test("the login notice shows once per sign-in, and again for a new announcement", async ({ browser }) => {
  const page = await fresh(browser);
  await page.goto("/login");
  await page.getByLabel("Nama pengguna").fill(ADMIN.username);
  await page.getByLabel("Kata sandi").fill(ADMIN.password);
  await page.getByRole("button", { name: "Masuk" }).click();

  const notice = page.getByRole("dialog", { name: /Selamat datang/ });
  await expect(notice.getByText("Perlu perhatian hari ini")).toBeVisible();
  await expect(notice.getByRole("link", { name: /Stok menipis/ })).toBeVisible();
  await shot(page, "01-login-notice");
  await notice.getByRole("button", { name: "Mengerti" }).click();
  await expect(notice).toBeHidden();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.waitForTimeout(1_500);
  await expect(notice).toBeHidden();

  // The sidebar counts low and negative stock on Produk & Stok.
  await expect(page.getByRole("link", { name: /^Produk & Stok\s*\d+$/ })).toBeVisible();
  await shot(page, "01b-sidebar-badges");

  await page.goto("/pengaturan");
  await page.getByLabel("Pengumuman untuk semua staf").fill("Sabtu ini stok opname, toko tutup jam 15.00.");
  await page.getByRole("button", { name: "Simpan pengumuman" }).click();
  await expect(notice.getByText("Sabtu ini stok opname, toko tutup jam 15.00.")).toBeVisible();
  await shot(page, "02-login-notice-announcement");
  await notice.getByRole("button", { name: "Mengerti" }).click();
  await page.getByRole("button", { name: "Hapus pengumuman" }).click();
  await expect(page.getByRole("button", { name: "Hapus pengumuman" })).toBeHidden();
  await expect(notice).toBeHidden();
  await page.context().close();
});

test("a kasir sale marked Diantar lands in Antrian Antar and drivers take turns", async ({ browser }) => {
  const admin = await fresh(browser);
  await login(admin, ADMIN);
  expect(
    (await admin.request.post("/api/users", { data: { username: KASIR_ANTAR.username, name: "Kasir Antar", role: "kasir", password: KASIR_ANTAR.password } })).ok(),
  ).toBe(true);

  await admin.goto("/antrian-antar");
  await expect(admin.getByText("Tidak ada barang yang menunggu")).toBeVisible();
  await admin.getByRole("button", { name: "Kelola sopir" }).click();
  const drivers = admin.getByRole("dialog", { name: "Kelola sopir" });
  for (const name of ["Budi", "Andi"]) {
    await drivers.getByLabel("Nama sopir baru").fill(name);
    await drivers.getByRole("button", { name: "Tambah" }).click();
    await expect(drivers.getByLabel(`Nama ${name}`)).toBeVisible();
  }
  await drivers.getByRole("button", { name: "Tutup" }).click();

  // Kasir: pay with "Diantar ke alamat".
  const kasir = await fresh(browser);
  await login(kasir, KASIR_ANTAR);
  await kasir.getByLabel("Cari produk atau scan barcode").fill("kilau enamel hitam");
  await kasir.getByLabel("Cari produk atau scan barcode").press("Enter");
  await kasir.getByLabel("Diantar ke alamat").check();
  const pay = kasir.getByRole("button", { name: /Bayar & cetak struk/ });
  await expect(pay).toBeDisabled();
  await kasir.getByLabel("Nama penerima").fill("Bu Sari");
  await kasir.getByLabel("Alamat antar").fill("Jl. Melati 7, RT 02");
  await kasir.getByLabel("Catatan antar").fill("Pagar hijau");
  await shot(kasir, "03-kasir-diantar");
  await pay.click();
  await expect(kasir.getByLabel("Diantar ke alamat")).not.toBeChecked();

  await kasir.getByRole("link", { name: "Antrian Antar" }).click();
  const kasirCard = kasir.getByRole("listitem").filter({ hasText: "Bu Sari" });
  await expect(kasirCard).toContainText("Jl. Melati 7, RT 02");
  await expect(kasirCard).toContainText("1× Kilau Enamel Hitam 1 L");
  await expect(kasirCard).toContainText(/Nota K1-\d{6}-\d{4}/);
  await shot(kasir, "04-kasir-antrian");

  // Office: a second delivery by hand, behind Bu Sari in the queue.
  await admin.reload();
  await admin.getByRole("button", { name: "Tambah antaran" }).click();
  const add = admin.getByRole("dialog", { name: "Tambah antaran" });
  await add.getByLabel("Nama pelanggan").fill("Pak Joko");
  await add.getByLabel("Alamat antar").fill("Jl. Kenanga 3");
  await add.getByRole("button", { name: "Masukkan ke antrian" }).click();
  const waiting = admin.getByRole("region", { name: "Menunggu" }).getByRole("listitem");
  await expect(waiting).toHaveCount(2);
  await expect(waiting.nth(0)).toContainText("Bu Sari");
  await expect(waiting.nth(1)).toContainText("Pak Joko");
  await shot(admin, "05-antrian-two-waiting");

  // Nobody delivered yet: Andi before Budi by name.
  await waiting.nth(1).getByRole("button", { name: "Berangkat" }).click();
  const depart = admin.getByRole("dialog", { name: "Berangkat ke Pak Joko" });
  await expect(depart.getByRole("radio", { name: /Andi/ })).toBeChecked();
  await expect(depart.getByText("Giliran berikutnya")).toBeVisible();
  await shot(admin, "06-berangkat-dialog");
  await depart.getByRole("button", { name: "Andi berangkat sekarang" }).click();

  const andi = admin.getByRole("article", { name: "Sopir Andi" });
  await expect(andi).toContainText("Sedang mengantar");
  await expect(andi).toContainText("Pak Joko");
  await shot(admin, "07-andi-on-the-way");
  await andi.getByRole("button", { name: "Sudah sampai" }).click();
  await expect(andi).toContainText("Siap");

  // Andi just came back, so Budi (never delivered) is next.
  await waiting.first().getByRole("button", { name: "Berangkat" }).click();
  const second = admin.getByRole("dialog", { name: "Berangkat ke Bu Sari" });
  await expect(second.getByRole("radio", { name: /Budi/ })).toBeChecked();
  await second.getByRole("button", { name: "Budi berangkat sekarang" }).click();
  const budi = admin.getByRole("article", { name: "Sopir Budi" });
  await expect(budi).toContainText("Sedang mengantar");

  // The kasir sees it move (auto refresh) and finishes it.
  const kasirBudi = kasir.getByRole("article", { name: "Sopir Budi" });
  await expect(kasirBudi).toContainText("Bu Sari", { timeout: 15_000 });
  await kasirBudi.getByRole("button", { name: "Sudah sampai" }).click();
  await expect(kasirBudi).toContainText("Siap");

  await admin.reload();
  await expect(admin.getByText("Tidak ada barang yang menunggu")).toBeVisible();
  const done = admin.getByRole("region", { name: "Selesai hari ini" });
  await expect(done).toContainText("Pak Joko");
  await expect(done).toContainText("Sampai · Budi");
  await expect(admin.getByRole("article", { name: "Sopir Andi" })).toContainText("Giliran berikutnya");
  await shot(admin, "08-antrian-done");
  await admin.context().close();
  await kasir.context().close();
});
