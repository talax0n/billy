import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

/** Run through `pnpm e2e`, which starts the servers and sets E2E_BASE_URL. */
const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) throw new Error("E2E_BASE_URL is not set: run the suite with `pnpm e2e`");

export default defineConfig({
  testDir: "specs",
  // The specs build on each other's data (the dashboard counts the sales made earlier), so one
  // worker runs the files in name order against the same database.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    headless: true,
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    viewport: { width: 1366, height: 860 },
    trace: "retain-on-failure",
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ??
        join(homedir(), "Library/Caches/ms-playwright/chromium-1252/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
    },
  },
});
