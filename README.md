# Billy

Internal bookkeeping and point-of-sale app for Toko Cat Sumber Karya. It replaces the legacy E-Jurnal UMKM site.

## Layout

| Path | What it is |
|---|---|
| `apps/api` | Hono API, served under `/api`. Deploys to Vercel. |
| `apps/web` | Vite + React SPA. Runs in the browser and inside `apps/desktop`. |
| `apps/desktop` | Electron shell around the web build: silent receipt printing, on-disk offline storage. |
| `packages/core` | Domain rules (money, totals, status, numbering, dates) and the zod schemas shared by API and web. |
| `packages/db` | Drizzle schema, migrations, `createDb()`, first-run seed. |
| `docs/` | Legacy discovery, tech stack, data model, and UI direction. Read these first. |

## Develop

Requires Node 22+ and pnpm 10.

```sh
pnpm install
pnpm dev        # api on :8787, web on :5173 (proxies /api)
pnpm test
pnpm typecheck
pnpm build
pnpm e2e        # end-to-end suite, see below
```

`pnpm dev` needs no database server. Without `DATABASE_URL` the API runs on PGlite stored in `.data/pglite`, applies migrations, and seeds an empty database with sample data and an `admin` user. The password is `SEED_ADMIN_PASSWORD`, or the dev-only default printed in the console. Delete `.data/` to start over.

`pnpm e2e` runs the Playwright suite in `e2e/specs`. It starts the API on a fresh PGlite data dir in a temp folder (migrated and seeded on boot) and the web dev server, each on a free port, runs the specs headless in Chromium, then stops both and deletes the data. The specs run in file order against one database, because later ones count the data earlier ones made. Chromium is not downloaded: set `CHROMIUM_PATH` to a Chromium or Chrome for Testing binary (the default is the Playwright 1252 build under `~/Library/Caches/ms-playwright`). Arguments pass through to `playwright test`, e.g. `pnpm e2e specs/10-pos.spec.ts`.

Set `DATABASE_URL` to use Postgres (the Neon pooled URL in production) instead. Tests always use an in-memory PGlite.

To work on a copy of the production data, `NEON_URL_FILE=<file holding the Neon URL> tools/pull-prod.sh` replaces the local Postgres database `billy_prod` with the deployed one (read-only on Neon; needs Homebrew `postgresql@16` running and `libpq` for a Postgres 18 `pg_dump`). Then `pnpm dev:prod`, and sign in with the production passwords.

After changing `packages/db/src/schema.ts`, generate a migration:

```sh
pnpm --filter @billy/db generate
```

## Desktop app

The desktop app serves `apps/web/dist` from `app://billy/` and forwards `app://billy/api/*` to the API, so the web app's relative `/api` calls and its session cookie work unchanged. The API origin is `BILLY_API_URL`, else `apiUrl` in `settings.json` in the app's userData folder, else `http://localhost:8787`.

```sh
pnpm --filter @billy/desktop dev      # Electron on the Vite dev server (start `pnpm dev` first)
pnpm --filter @billy/desktop package  # build, then installer in apps/desktop/release (dmg on macOS, NSIS on Windows); add `-- --dir` for an unpacked app
pnpm --filter @billy/desktop smoke    # after `pnpm build`: login, silent print, offline sale across a restart (needs pdftotext)
```

Start the kasir PC with `--kiosk` to open `/kasir` fullscreen. F11 toggles fullscreen. Pick the receipt printer in the cashier settings (Printer struk).

## Adding a module

Copy the products module, which is the reference for every other module:

1. Schemas: `packages/core/src/schemas/<module>.ts`, exported from `packages/core/src/index.ts`.
2. API: `apps/api/src/modules/<module>/routes.ts` and `service.ts`, mounted with one `.route()` line in `apps/api/src/app.ts`. Guard the router with `backOffice()`, `adminOnly()` or `requireRole(...)` from `apps/api/src/auth/require-role.ts`.
3. Web: a page in `apps/web/src/routes/<module>/`, registered with one entry in `apps/web/src/nav.tsx`.
