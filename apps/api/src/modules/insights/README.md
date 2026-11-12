# Ringkasan, Perlu Tindakan, and reports

Read endpoints, protected with `backOffice()`:

- `GET /api/insights/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD&account=<uuid>&weeks=12|26`
- `GET /api/insights/actions?q=&page=1&pageSize=25` returns ranked `rows`, filtered `total`, and unfiltered `count` for the sidebar badge.
- `GET /api/reports/cash-book.xlsx?from=&to=&account=`
- `GET /api/reports/sales.xlsx?from=&to=`

The account filter applies to cash flow, chart, and cash-book export. Sales and invoice balances are shop-wide because unpaid invoices do not belong to a cash account. The balance pill is current cash + bank; the ranked card includes e-wallet accounts too. The card shows the top five, with a link to Kas & Bank. Each report read uses a repeatable-read snapshot.

Dates are inclusive Jakarta business dates. Bulan ini is month-to-date; Bulan lalu is the full previous month; 30 hari includes today. Comparisons use the immediately preceding window with exactly the same number of days. Zero-to-nonzero percentage deltas are `null` and displayed as “Baru”. Receivables are outstanding at the selected end date; due payables include overdue bills and bills due through seven days after that date. Historical balance comparisons use document/payment dates and void timestamps to reconstruct the outstanding amount at each end date. Sales and gross profit exclude voided documents. Gross profit uses line totals and cost snapshots, without subtracting document discounts a second time.

Cash balances include every ledger row, including transfers and reversals. Cash-flow metrics exclude `sourceType=transfer`, including transfer reversals. Other reversals stay in their actual direction, so net cash reconciles with the ledger. Excel cash books include all ledger categories, an opening balance per account, and running balances. Money cells are numbers with a rupiah number format.

Action priority and navigation live in the core registry. Negative stock comes first, then overdue customers (grouped), supplier bills, low stock, and cash deposit suggestions. Within a priority, older due dates precede larger amounts, then stable IDs. The cash threshold is `CASH_DEPOSIT_THRESHOLD` in core. Resolution links target the existing navigation paths; this module has no dependency on other workers' endpoints.

## Demo and verification

Stop the dev API before running `pnpm --filter @billy/api seed:demo`, then start `pnpm dev`. The seed command uses only the local PGlite database and refuses production or `DATABASE_URL`. It creates the standard admin if the database is empty, then calls the same `seedInsightDemo` fixture as the API tests. A dedicated account code makes repeated seeding a no-op. Fake transactions span six months and include stock/cash reversals, a voided payment, and normal/voided transfers. No schema changes are needed.

Core tests cover periods, deltas, profit snapshots, ranking, thresholds, and cash derivation. PGlite API tests assert exact money and reversal rows, void exclusions, account scope, workbook numeric cells, validation, authentication, and kasir denial. Browser proof covers login, filters, both chart windows, two exports, rejected dates, action search/navigation, badge count, and light/dark screenshots.

Reads currently load the shop's dated ledger and document projections into memory for shared pure calculations; a larger deployment should replace these projections with bounded/aggregated queries while preserving the core contracts and literal tests.
