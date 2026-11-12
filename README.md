# Billy

Internal bookkeeping and point-of-sale app for Toko Cat Sumber Karya. It replaces the legacy E-Jurnal UMKM site.

## Layout

| Path | What it is |
|---|---|
| `apps/api` | Hono API, served under `/api`. Deploys to Vercel. |
| `apps/web` | Vite + React SPA. The Electron app will wrap this build. |
| `packages/core` | Shared domain types and rules, such as `Rupiah` money. |
| `docs/` | Legacy discovery, tech stack, and UI direction. Read these first. |

## Develop

Requires Node 22+ and pnpm 10.

```sh
pnpm install
pnpm dev        # api on :8787, web on :5173 (proxies /api)
pnpm test
pnpm typecheck
pnpm build
```
