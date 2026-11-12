// Keeps the app shell loadable offline once the cashier page was opened online.
// Network first for every same-origin GET outside /api, so a deploy shows up on the next
// load; the cached copy answers only when the network fails. Navigations fall back to the
// cached index.html, which boots the SPA on any route.
const CACHE = "billy-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add("/")).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request.mode === "navigate" ? "/" : request, copy));
        }
        return response;
      })
      // ignoreVary: the shell files were cached by the page without the Origin header a module script sends.
      .catch(async () => (await caches.match(request.mode === "navigate" ? "/" : request, { ignoreVary: true })) ?? Response.error()),
  );
});
