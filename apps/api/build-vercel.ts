/**
 * Writes the API as one prebuilt Vercel function (Build Output API), so Vercel neither
 * type-checks nor re-bundles the workspace's TypeScript sources.
 *
 *   pnpm --filter @billy/api build:vercel
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const out = ".vercel/output";
const fn = `${out}/functions/index.func`;
rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

await build({
  entryPoints: ["src/vercel.ts"],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Dev-only database and pg's optional native binding; neither is loaded in production.
  external: ["@electric-sql/pglite", "drizzle-orm/pglite", "drizzle-orm/pglite/*", "pg-native"],
  // CommonJS dependencies (pg, exceljs) call require() on Node built-ins.
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  logLevel: "info",
});

writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false }),
);
writeFileSync(`${fn}/package.json`, JSON.stringify({ type: "module" }));
writeFileSync(`${out}/config.json`, JSON.stringify({ version: 3, routes: [{ src: "/(.*)", dest: "/index" }] }));
