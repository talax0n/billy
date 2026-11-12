import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";

export const APP_ORIGIN = "app://billy";

/** Must run before `app` is ready. `standard` + `secure` give the scheme a real origin for cookies, IndexedDB and CSP. */
export function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
}

/**
 * Serves the built web app on `app://billy/` with an SPA fallback to index.html, and
 * forwards `app://billy/api/*` to the API. The web app keeps calling relative `/api`
 * paths, so in its eyes the API is same-origin, as it is behind Vercel or the Vite proxy.
 */
export function serveApp(webRoot: string, apiUrl: string) {
  const indexHtml = join(webRoot, "index.html");
  const csp = contentSecurityPolicy(readFileSync(indexHtml, "utf8"));

  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    if (url.host !== "billy") return new Response(null, { status: 404 });
    if (url.pathname.startsWith("/api/")) return forward(request, new URL(url.pathname + url.search, apiUrl));

    const path = normalize(join(webRoot, decodeURIComponent(url.pathname)));
    if (!path.startsWith(webRoot + sep)) return new Response(null, { status: 404 });
    const file = isFile(path) ? path : indexHtml;
    const res = await net.fetch(pathToFileURL(file).href);
    const headers = new Headers(res.headers);
    headers.set("content-security-policy", csp);
    return new Response(res.body, { status: res.status, headers });
  });
}

/**
 * `credentials: "include"` makes net.fetch store the API's Set-Cookie in the session's
 * cookie jar (keyed by the API origin, persisted in userData) and send it back on the next
 * forwarded request. The page itself never holds the session cookie.
 */
async function forward(request: Request, target: URL) {
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return net.fetch(target.href, {
    method: request.method,
    headers: request.headers,
    body: hasBody ? await request.arrayBuffer() : null,
    credentials: "include",
  }).catch(() => Response.error()); // API unreachable: the page's fetch fails like any offline request.
}

function isFile(path: string) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** index.html carries one inline script (the theme, applied before first paint): allow exactly that by hash. */
function contentSecurityPolicy(indexHtml: string) {
  const hashes = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    ([, body]) => `'sha256-${createHash("sha256").update(body!).digest("base64")}'`,
  );
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(" ")}`,
    // React style attributes and the receipt's print <style>.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
