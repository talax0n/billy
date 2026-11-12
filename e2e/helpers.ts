import { expect, type Page } from "@playwright/test";

export const ADMIN = { username: "admin", password: "admin12345" };
export const KASIR = { username: "kasir1", password: "kasir12345" };

/** Signs in through the login form and waits for the landing page of the role. */
export async function login(page: Page, user: { username: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Nama pengguna").fill(user.username);
  await page.getByLabel("Kata sandi").fill(user.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** `Rp 1.234.567` as the app prints it (Indonesian grouping, no decimals). */
export const rp = (value: number) => `Rp ${value.toLocaleString("id-ID")}`;

/** Today's business date in Jakarta as `YYMMDD`, the period part of every document number. */
export const docPeriod = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "2-digit", month: "2-digit", day: "2-digit" })
    .format(new Date())
    .replaceAll("-", "");

/** `SO-261113-0001` for the n-th document of today. */
export const docNumber = (prefix: string, n: number) => `${prefix}-${docPeriod()}-${String(n).padStart(4, "0")}`;
