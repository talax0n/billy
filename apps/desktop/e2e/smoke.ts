// End-to-end check of the built shell against a real API on a throwaway PGlite database:
// login through the app:// proxy, a silent receipt print, an offline sale that survives a
// restart, and the outbox draining once the API is back. Needs `pnpm build` first and
// `pdftotext` (poppler) on PATH. Set SHOTS_DIR to also save light and dark screenshots.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";

const desktopDir = fileURLToPath(new URL("..", import.meta.url));
const apiDir = join(desktopDir, "../api");
const port = 8797;
const apiUrl = `http://localhost:${port}`;
const tmp = mkdtempSync(join(tmpdir(), "billy-desktop-"));
const pdf = join(tmp, "receipt.pdf");

let api: ChildProcess | undefined;

async function startApi() {
  api = spawn(join(apiDir, "node_modules/.bin/tsx"), ["src/dev.ts"], {
    cwd: apiDir,
    env: { ...process.env, PORT: String(port), PGLITE_DIR: join(tmp, "pglite") },
    detached: true,
    stdio: "ignore",
  });
  for (let i = 0; i < 120; i++) {
    if (await fetch(`${apiUrl}/api/auth/me`).then(() => true, () => false)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("API did not start");
}

async function stopApi() {
  if (!api?.pid) return;
  const exited = new Promise((r) => api!.once("exit", r));
  process.kill(-api.pid, "SIGTERM");
  await exited;
  api = undefined;
}

async function launch(...flags: string[]) {
  // BILLY_EXECUTABLE runs a packaged app (e.g. release/mac-arm64/Billy.app/Contents/MacOS/Billy) instead of dist/.
  const packaged = process.env.BILLY_EXECUTABLE;
  const app = await electron.launch({
    ...(packaged ? { executablePath: packaged } : {}),
    args: [...(packaged ? [] : [join(desktopDir, "dist/main.js")]), `--user-data-dir=${join(tmp, "profile")}`, ...flags],
    env: { ...process.env, BILLY_API_URL: apiUrl },
  });
  const page = await app.firstWindow();
  // Stand-in for the receipt printer: the silent print call renders a PDF instead.
  await app.evaluate(({ webContents }, out) => {
    const proto = Object.getPrototypeOf(webContents.getAllWebContents()[0]) as Electron.WebContents;
    proto.print = function (this: Electron.WebContents, options, callback) {
      void this.printToPDF({ preferCSSPageSize: true }).then((data) => {
        process.getBuiltinModule("node:fs").writeFileSync(out, data);
        callback?.(options?.silent === true, "");
      });
    };
  }, pdf);
  return { app, page };
}

/** Sells one unit of the first search hit and returns the receipt number, read from the print portal. */
async function sell(page: Page) {
  const receiptNumber = () => document.querySelector("#pos-receipt [data-testid=receipt] span")?.textContent ?? "";
  const before = await page.evaluate(receiptNumber);
  await page.getByLabel("Cari produk atau scan barcode").fill("a");
  await page.getByRole("listbox", { name: "Hasil pencarian" }).getByRole("option").first().click();
  await page.getByRole("button", { name: /Bayar & cetak struk/ }).click();
  await page.waitForFunction(
    (prev) => (document.querySelector("#pos-receipt [data-testid=receipt] span")?.textContent ?? "") !== prev,
    before,
  );
  return page.evaluate(receiptNumber);
}

/** Waits until the status bar's "n transaksi menunggu sinkron" reads `text` ("" once the outbox is empty). */
const pendingIs = (page: Page, text: string, timeout = 30_000) =>
  page.waitForFunction(
    (t) => {
      const shown = document.querySelector("[data-testid=sync-pending]")?.textContent;
      return shown != null && (t ? shown.includes(t) : shown === "");
    },
    text,
    { timeout },
  );

function check(ok: boolean, message: string) {
  if (!ok) throw new Error(message);
  console.log(`ok - ${message}`);
}

let app: ElectronApplication | undefined;
try {
  await startApi();
  let page: Page;
  ({ app, page } = await launch());

  await page.waitForURL("app://billy/login");
  await page.getByLabel("Nama pengguna").fill("admin");
  await page.getByLabel("Kata sandi").fill(process.env.SEED_ADMIN_PASSWORD ?? "admin12345");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL("app://billy/");
  check(true, "logged in through the app:// proxy");

  await page.goto("app://billy/kasir");
  await page.getByTitle("Pengaturan kasir").click();
  await page.getByLabel("Printer struk").waitFor();
  check(true, "desktop-only receipt printer select shows in the cashier settings");
  await page.keyboard.press("Escape");
  const first = await sell(page);
  for (let i = 0; !existsSync(pdf) && i < 50; i++) await new Promise((r) => setTimeout(r, 100));
  check(execFileSync("pdftotext", [pdf, "-"], { encoding: "utf8" }).includes(first), `silent print rendered receipt ${first}`);
  await pendingIs(page, "");
  check(true, "online sale uploaded");

  await stopApi();
  const second = await sell(page);
  await pendingIs(page, "1 transaksi menunggu");
  check(true, `offline sale ${second} queued`);

  await app.close();
  ({ app, page } = await launch("--kiosk"));
  await page.waitForURL("app://billy/kasir");
  await pendingIs(page, "1 transaksi menunggu");
  check(true, "queued sale survived a restart while offline (kiosk start on /kasir)");

  await startApi();
  await pendingIs(page, "", 90_000);
  check(true, "outbox drained after the API came back");

  if (process.env.SHOTS_DIR) {
    mkdirSync(process.env.SHOTS_DIR, { recursive: true });
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({ path: join(process.env.SHOTS_DIR, `kasir-${scheme}.png`) });
    }
  }
} finally {
  await app?.close();
  await stopApi();
  rmSync(tmp, { recursive: true, force: true });
}
