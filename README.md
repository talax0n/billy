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
```

`pnpm dev` needs no database server. Without `DATABASE_URL` the API runs on PGlite stored in `.data/pglite`, applies migrations, and seeds an empty database with sample data and an `admin` user. The password is `SEED_ADMIN_PASSWORD`, or the dev-only default printed in the console. Delete `.data/` to start over.

Set `DATABASE_URL` to use Postgres (the Neon pooled URL in production) instead. Tests always use an in-memory PGlite.

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
