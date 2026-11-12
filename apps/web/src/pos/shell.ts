/**
 * Registers `/sw.js` so the cashier loads with no network after one online visit. The files
 * of this first load were fetched before the worker existed, so the built assets are cached here too.
 */
export async function cacheAppShell() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  await navigator.serviceWorker.register("/sw.js");
  const files = performance
    .getEntriesByType("resource")
    .map((entry) => new URL(entry.name))
    .filter((url) => url.origin === location.origin && url.pathname.startsWith("/assets/"))
    .map((url) => url.pathname);
  const cache = await caches.open("billy-shell-v1");
  await cache.addAll(["/", ...new Set(files)]);
}
