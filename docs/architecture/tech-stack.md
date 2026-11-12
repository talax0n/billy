# Tech stack (proposal, 2026-11-12)

Context: one shop, internal use, records entered by hand from the legacy site. The accounting model is a cash book plus open invoices, with item cost stored so double-entry can be added later. See `docs/discovery/existing-system.md`.

Clients, in build order: web, then desktop (Electron), then mobile (iOS and Android), then a Telegram bot.

## Principles

- **TypeScript everywhere.** One language lets the domain types, validation schemas, and money math be shared by every app.
- **One API serves every client.** Web, desktop, mobile, and bot all call the same HTTP API, and no client talks to the database. Business rules (totals, payment status, stock movement) live only on the server. The legacy app trusted totals computed in the browser, and this rule exists to prevent that.
- **The desktop app is the web app in a shell.** Electron loads the same React build and adds only what a browser cannot do, such as silent receipt printing, cash-drawer kick, and auto-update. There is no second UI codebase.
- **Add a package only when a second app needs it.** Start with the fewest packages that work.

## Layout

```
apps/
  api/        Hono on Node. REST + typed RPC client. Auth, business rules, reports.
  web/        Vite + React SPA. Used in the browser and inside Electron.
  desktop/    Electron shell around apps/web. Printing, drawer, auto-update.
  mobile/     Expo (React Native). Later.
  bot/        grammY Telegram bot that calls apps/api. Later.
packages/
  core/       Domain types, zod schemas, money (integer rupiah), document numbering, pure rules.
  db/         Drizzle schema, migrations, seed.
```

The `ui` and `api-client` packages are skipped for now. The web and desktop apps share one codebase already, and the Hono RPC client comes from the API's exported type. Add a `ui` package when mobile needs shared tokens.

## Choices

| Concern | Pick | Why | Alternative considered |
|---|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | It is the standard JS monorepo setup, with cached builds and simple filters. | Nx, which is heavier than this project needs |
| API framework | Hono | It is small, has a typed RPC client (`hc`) with no codegen, and runs on Node, Bun, or edge. | NestJS (too much ceremony), tRPC (fine, but REST is easier for the bot and for debugging) |
| Validation | zod, shared from `packages/core` | One schema validates input on the server and powers forms on the client. | |
| Database | PostgreSQL | Transactions, `CHECK` constraints, and `bigint` money. Reports need real SQL. | MySQL (works, but has weaker constraints), SQLite (no good fit for multiple clients) |
| ORM / migrations | Drizzle | SQL-shaped, typed, light migrations, no runtime engine. | Prisma |
| Money | Integer rupiah as `bigint` in the database and `number` in TS, with an assertion that the value is a safe integer | Rupiah has no subunit in practice, and integer math avoids float bugs. | `numeric` + decimal.js, only if fractional prices appear |
| Auth | Session cookie for web and desktop, bearer token for mobile and bot. Better Auth, or a hand-rolled sessions table. | Few users, with roles admin, staff, and kasir. | |
| Web UI | React + TanStack Router + TanStack Query + Tailwind + shadcn/ui | An internal app needs no SSR. A single SPA bundle drops straight into Electron. | Next.js (SSR is wasted on this app and complicates Electron) |
| Tables / forms | TanStack Table, react-hook-form + zod | Large lists (4k products, 10k invoices) paginated on the server. Invoice line editors. | |
| Desktop | Electron + electron-builder + electron-updater | Your pick. It adds ESC/POS printing over USB or network. | Tauri (smaller binary, but Rust and a different printing story) |
| Mobile | Expo (React Native) + Expo Router | Shares `packages/core` and the API client. Over-the-air updates. | Capacitor wrapping the web app (cheaper, but the UX is worse for a POS or stock check) |
| Telegram bot | grammY | Type-safe, small, webhook or long-polling. Reads stock and sales summaries through the API, and the API restricts it to an allow-list of Telegram user IDs. | |
| Reports / export | SQL views + `exceljs` for Excel, HTML print pages for faktur and surat jalan | Matches the current outputs. | |
| File uploads (payment proof) | S3-compatible storage (Cloudflare R2 or MinIO), or local disk at first | Proof images, product photos. | |
| Testing | Vitest for core and API (against a real Postgres), Playwright for web | Money and posting rules need real checks. | |
| Hosting | **Decided:** Vercel (web + API as Hono functions, region `sin1` Singapore) + Neon Postgres (`ap-southeast-1`). Drizzle uses the Neon serverless driver. | The owner's choice. There are no servers to run. Both regions are close to Indonesia. | A VPS with Docker Compose |
| Offline sync | **Proposed:** PowerSync (hosted service). It replicates Neon into a local SQLite on each client. Local writes queue and upload through our own API. | Supports Neon, Web, Electron, and Expo with one model. Writes still pass server validation. | Hand-rolled outbox + pull cursor (no vendor, but a lot more work). Electric (read sync only, so writes are also ours to build). Zero (needs a long-running `zero-cache` server, a poor fit for Vercel). |

## Offline implementation for v1 (decided 2026-11-13)

PowerSync needs a hosted service account, so v1 does not use it. Only the cashier PC sells offline. v1 therefore uses a small client **outbox**: the POS caches products and accounts in IndexedDB, queues each sale as an idempotent command keyed by its client UUID, and flushes the queue to `POST /api/pos/sales` when online. The server ignores a sale ID it already holds. The rules below still hold, so PowerSync can replace the outbox later without a schema change.

## Offline-first design (decided 2026-11-12: the app works offline and syncs automatically)

```
 client (web / Electron / Expo)                     cloud
 ┌───────────────────────────────┐   upload queue   ┌──────────────────────┐
 │ UI ─reads─▶ local SQLite      │ ───────────────▶ │ apps/api on Vercel    │
 │ UI ─writes─▶ local SQLite      │   (POST /sync)   │ validates, recomputes │
 │             + upload queue     │                  │ writes to Neon        │
 │                                │ ◀─────────────── │                       │
 │                                │  PowerSync       │ Neon ─logical repl─▶  │
 │                                │  streams         │ PowerSync service     │
 └───────────────────────────────┘                   └──────────────────────┘
```

The sync tool moves rows. The domain rules below are what make offline data safe. They hold whichever tool is used.

1. **IDs are client-generated UUIDv7.** An upload that is retried after a dropped connection writes the same row again, never a duplicate sale.
2. **The server stays authoritative.** Uploads go through `apps/api`, which recomputes totals, discounts, and status from the lines. A rejected write lands in a visible "sync issues" list. It is never dropped silently.
3. **Transactions are append-only.** Sales, purchases, payments, POS receipts, transfers, and cash rows are never edited in place. A correction is a void plus a new document. Append-only records cannot conflict.
4. **Balances and stock are derived, not stored counters.** An account balance is the sum of its cash rows. Stock is the sum of stock movements. Two offline devices selling the same item both apply cleanly. Overselling while offline is allowed and shows up as negative stock to review.
5. **Document numbers are allocated per device.** A receipt must print a number while offline, so each device owns a series, for example `K1-261112-0001`. A global sequence is impossible offline.
6. **Master data is last-write-wins per row.** This covers products, prices, and contacts. The sale line copies the price and cost at sale time, so a later price edit never rewrites history.
7. **Each client syncs only the working set.** That means master data, open invoices, and recent transactions. Full history (95k+ rows) stays server-side and is read online through reports.
8. **Storage durability.** Electron stores a real SQLite file in the main process (PowerSync Node SDK). The browser uses OPFS SQLite and requests `navigator.storage.persist()`, but browsers can still evict it. **The cashier PC should run the desktop app, not a browser tab.** The web app needs a service worker so the app shell loads offline.
9. **Auth while offline.** The API issues the JWT that PowerSync uses. An expired token pauses sync but never blocks local work. Sync resumes after re-login.

## Open decisions

1. **Receipt printer.** Deferred. The model and how it connects (USB, LAN, or Bluetooth) decide the Electron printing approach.
2. **PowerSync plan and cost.** Check the current pricing and free-tier limits before committing, or self-host the open edition later.

**Decided 2026-11-12:** only one cashier PC sells offline, so there is one POS number series (`K1-…`). The per-device series design stays, so a second device can be added later without a migration.
