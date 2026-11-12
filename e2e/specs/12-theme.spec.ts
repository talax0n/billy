import { expect, test } from "@playwright/test";
import { ADMIN, login } from "../helpers.ts";

test("switches between light and dark and keeps the choice after a reload", async ({ page }) => {
  await login(page, ADMIN);
  const html = page.locator("html");
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const theme = page.getByRole("radiogroup", { name: "Tema" });

  await theme.getByRole("radio", { name: "Terang" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  const light = await background();

  await theme.getByRole("radio", { name: "Gelap" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  expect(await background()).not.toBe(light);

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(theme.getByRole("radio", { name: "Gelap" })).toBeChecked();

  await theme.getByRole("radio", { name: "Terang" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  expect(await background()).toBe(light);
});
