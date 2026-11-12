import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { app, Menu, session } from "electron";
import { registerPrinting } from "./printing.ts";
import { APP_ORIGIN, registerAppScheme, serveApp } from "./protocol.ts";
import { settings } from "./settings.ts";
import { createWindow, lockToOrigin } from "./window.ts";

// BILLY_DEV_URL (the Vite dev server, which proxies /api itself) replaces the bundled build in `pnpm dev`.
const devUrl = process.env.BILLY_DEV_URL;
const apiUrl = process.env.BILLY_API_URL ?? settings().apiUrl ?? "http://localhost:8787";
const origin = devUrl ? new URL(devUrl).origin : APP_ORIGIN;
// The kasir PC starts with `--kiosk`: straight into the cashier, fullscreen.
const kiosk = process.argv.includes("--kiosk");

registerAppScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void app.whenReady().then(() => {
    if (!devUrl) {
      const webRoot = app.isPackaged ? join(process.resourcesPath, "web") : fileURLToPath(new URL("../../web/dist", import.meta.url));
      serveApp(webRoot, apiUrl);
    }
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    // Windows and Linux get no menu bar; macOS keeps the default menu for copy, paste and quit.
    if (process.platform !== "darwin") Menu.setApplicationMenu(null);
    lockToOrigin(origin);
    registerPrinting(origin);

    const win = createWindow(`${origin}${kiosk ? "/kasir" : "/"}`, kiosk);
    app.on("second-instance", () => {
      if (win.isMinimized()) win.restore();
      win.focus();
    });
  });
  app.on("window-all-closed", () => app.quit());
}
