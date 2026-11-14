#!/usr/bin/env bash
# Copies the deployed Neon database into a local Postgres database (default billy_prod), replacing it.
# Read-only on Neon. Run `pnpm dev:prod` afterwards.
#
#   NEON_URL_FILE=/path/to/file-with-url tools/pull-prod.sh     (or NEON_URL=postgresql://...)
set -euo pipefail

url="${NEON_URL:-$(cat "${NEON_URL_FILE:?set NEON_URL or NEON_URL_FILE}")}"
db="${LOCAL_DB:-billy_prod}"
# Neon runs Postgres 18; Homebrew's libpq ships a matching pg_dump.
bin="${PG_BIN:-/opt/homebrew/opt/libpq/bin}"
dump="$(mktemp -d)/neon"
trap 'rm -rf "$(dirname "$dump")"' EXIT

# Parallel jobs: one connection to Neon is slow (about 30 KB/s from here); six are many times faster.
# neon_auth is Neon-managed and unused by the app, so only public and drizzle (migration history) are copied.
"$bin/pg_dump" "$url" -n public -n drizzle --no-owner --no-privileges -Fd -j 6 -Z 0 -f "$dump"

dropdb --if-exists "$db"
createdb "$db"
psql -q -d "$db" -c 'drop schema public'
# Neon tags every column with a pg_attver option that stock Postgres rejects, and a rejected line aborts its
# whole CREATE TABLE in pg_restore. Restoring through SQL text lets those lines be dropped.
"$bin/pg_restore" -f - --no-owner --no-privileges "$dump" \
  | grep -vE 'SET \(pg_attver=[0-9]+\);$|^SET transaction_timeout' \
  | psql -q -v ON_ERROR_STOP=1 -d "$db" > /dev/null
psql -d "$db" -Atc "select 'pos_sales ' || count(*) from pos_sales union all select 'sales_invoices ' || count(*) from sales_invoices union all select 'stock_movements ' || count(*) from stock_movements"
