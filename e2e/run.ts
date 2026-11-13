/**
 * `pnpm e2e`: starts the API on a fresh PGlite data dir (migrated and seeded on boot) and the
 * web dev server, each on a free port, runs the Playwright specs headless, then stops both.
 * Extra arguments go to `playwright test`, e.g. `pnpm e2e specs/08-pos.spec.ts --headed`.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

/** Each server runs in its own process group so stopping it also stops what it spawned. */
function start(name: string, command: string, args: string[], cwd: string, env: Record<string, string>): ChildProcess {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const log: string[] = [];
  const keep = (chunk: Buffer) => log.push(chunk.toString());
  child.stdout!.on("data", keep);
  child.stderr!.on("data", keep);
  child.once("exit", (code) => {
    if (!stopping) console.error(`[e2e] ${name} exited early (${code}):\n${log.join("")}`);
  });
  return child;
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || !child.pid) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  process.kill(-child.pid, "SIGTERM");
  const timeout = setTimeout(() => child.pid && process.kill(-child.pid, "SIGKILL"), 5000);
  await exited;
  clearTimeout(timeout);
}

/** The watchdog flags activity outside opening hours, so a run after closing time would see extra flags. */
async function openAllDay(api: string) {
  const login = await fetch(`${api}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin12345" }),
  });
  if (!login.ok) throw new Error(`e2e admin login failed: ${login.status}`);
  const headers = { cookie: login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "content-type": "application/json" };
  const current = await (await fetch(`${api}/api/settings/watchdog`, { headers })).json();
  const res = await fetch(`${api}/api/settings/watchdog`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ ...current, openTime: "00:00", closeTime: "23:59" }),
  });
  if (!res.ok) throw new Error(`e2e opening hours failed: ${res.status} ${await res.text()}`);
}

async function waitFor(url: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`[e2e] ${url} did not answer within ${timeoutMs / 1000} s`);
}

let stopping = false;
const dataDir = await mkdtemp(join(tmpdir(), "billy-e2e-"));
const [apiPort, webPort] = [await freePort(), await freePort()];
const servers: ChildProcess[] = [];
let exitCode = 1;

try {
  servers.push(
    start("api", join(root, "apps/api/node_modules/.bin/tsx"), ["src/dev.ts"], join(root, "apps/api"), {
      PORT: String(apiPort),
      PGLITE_DIR: join(dataDir, "pglite"),
      SEED_ADMIN_PASSWORD: "admin12345",
    }),
  );
  await waitFor(`http://localhost:${apiPort}/api/auth/me`);
  await openAllDay(`http://localhost:${apiPort}`);
  servers.push(
    start("web", join(root, "apps/web/node_modules/.bin/vite"), ["--port", String(webPort), "--strictPort"], join(root, "apps/web"), {
      API_URL: `http://localhost:${apiPort}`,
    }),
  );
  const baseURL = `http://localhost:${webPort}`;
  await waitFor(baseURL);

  const playwright = spawn(join(root, "e2e/node_modules/.bin/playwright"), ["test", ...process.argv.slice(2)], {
    cwd: join(root, "e2e"),
    env: { ...process.env, E2E_BASE_URL: baseURL },
    stdio: "inherit",
  });
  exitCode = await new Promise<number>((resolve) => playwright.once("exit", (code) => resolve(code ?? 1)));
} finally {
  stopping = true;
  await Promise.all(servers.map(stop));
  await rm(dataDir, { recursive: true, force: true });
}
process.exit(exitCode);
