import { fileURLToPath } from "node:url";
import { app, BrowserWindow, type Rectangle, screen, shell, type WebContents } from "electron";
import { saveSettings, settings } from "./settings.ts";

/** The main window, at its last size and position. F11 toggles fullscreen. */
export function createWindow(url: string, fullscreen: boolean) {
  const { bounds, maximized } = settings();
  const win = new BrowserWindow({
    ...(bounds && onScreen(bounds) ? bounds : { width: 1366, height: 768 }),
    minWidth: 1024,
    minHeight: 640,
    fullscreen,
    show: false,
    webPreferences: {
      preload: fileURLToPath(new URL("preload.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  win.on("close", () => saveSettings({ bounds: win.getNormalBounds(), maximized: win.isMaximized() }));
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });
  void win.loadURL(url);
  return win;
}

/** A monitor unplugged since last run would otherwise leave the window off-screen. */
function onScreen(b: Rectangle) {
  return screen.getAllDisplays().some(({ workArea: a }) => b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y);
}

/** Node's URL reports origin "null" for custom schemes like app://, so compare the prefix instead. */
export const onOrigin = (url: string, origin: string) => url === origin || url.startsWith(`${origin}/`);

/** Keeps every window (print pages opened with window.open too) on the app origin; other links go to the system browser. */
export function lockToOrigin(origin: string) {
  const openExternal = (url: string) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
  };
  app.on("web-contents-created", (_event, contents: WebContents) => {
    contents.on("will-navigate", (event, url) => {
      if (onOrigin(url, origin)) return;
      event.preventDefault();
      openExternal(url);
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (onOrigin(url, origin)) return { action: "allow" };
      openExternal(url);
      return { action: "deny" };
    });
  });
}
