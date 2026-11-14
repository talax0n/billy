import { expect, type Page } from "@playwright/test";

export const ADMIN = { username: "admin", password: "admin12345" };
export const KASIR = { username: "kasir1", password: "kasir12345" };

/** Signs in through the login form and waits for the landing page of the role. */
export async function login(page: Page, user: { username: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Nama pengguna").fill(user.username);
  await page.getByLabel("Kata sandi").fill(user.password);
  const attention = page.waitForResponse((r) => r.url().includes("/api/insights/attention"), { timeout: 15_000 }).catch(() => null);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  if (!/\/kasir/.test(page.url()) && (await attention)) await dismissLoginNotice(page);
}

/**
 * The back office greets each sign-in with "Perlu perhatian hari ini" (the sample data always has
 * low stock). Specs that are not about it close it, like staff would.
 */
export async function dismissLoginNotice(page: Page) {
  const notice = page.getByRole("dialog", { name: /Selamat datang/ });
  const shown = await notice.waitFor({ timeout: 3_000 }).then(
    () => true,
    () => false,
  );
  if (shown) {
    await notice.getByRole("button", { name: "Mengerti" }).click();
    await expect(notice).toBeHidden();
  }
}

/** `Rp 1.234.567` as the app prints it (Indonesian grouping, no decimals). */
export const rp = (value: number) => `Rp ${value.toLocaleString("id-ID")}`;

/** `1.234.567`, the bare amount table cells print under a `(Rp)` header. */
export const num = (value: number) => value.toLocaleString("id-ID");

/** Today's business date in Jakarta as `YYMMDD`, the period part of every document number. */
export const docPeriod = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "2-digit", month: "2-digit", day: "2-digit" })
    .format(new Date())
    .replaceAll("-", "");

/** `SO-261113-0001` for the n-th document of today. */
export const docNumber = (prefix: string, n: number) => `${prefix}-${docPeriod()}-${String(n).padStart(4, "0")}`;

/** On the Kasir screen without an open shift: opens one with `float` in the drawer. */
export async function openShift(page: Page, float: number) {
  const dialog = page.getByRole("dialog", { name: "Buka shift" });
  await dialog.getByLabel("Modal awal di laci").fill(String(float));
  await dialog.getByRole("button", { name: "Buka shift" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: /Shift sejak/ })).toBeVisible();
}
