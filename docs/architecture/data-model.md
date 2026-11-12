# Data model and module contract (v1, 2026-11-13)

This is the shared contract for every module. Read it together with `docs/architecture/tech-stack.md` (offline rules) and `docs/design/ui-direction.md` (screens). The legacy behaviour it replaces is described in `docs/discovery/existing-system.md`.

## Ground rules

1. **Money** is whole rupiah. In TypeScript it is `Rupiah` from `@billy/core`. In Postgres it is `bigint` with Drizzle `{ mode: "number" }`. Floats and formatted strings never cross a function boundary.
2. **IDs** are UUIDv7 strings. The client generates the ID for any write that can happen offline, which today means POS sales. The server generates all other IDs.
3. **Transactions are append-only.** Sales invoices, purchase invoices, payments, expenses, transfers, cash entries, POS sales, and stock movements are never updated in place. A correction is a **void**, which sets `voided_at`, `voided_by`, and `void_reason` on the document and writes **reversal rows** for its side effects (cash entries, stock movements). Every reversal row is dated on the **void date** (the business date when the void happens), never backdated to the original document, so periods already reported stay unchanged. Nothing is ever deleted.
4. **Balances and stock are derived.** An account balance is the sum of its `cash_entries`. Product stock is the sum of its `stock_movements`. Neither is stored as a counter.
5. **Invoice status is derived.** `paid = sum(non-voided payments)` and `outstanding = total - paid`. The status is `void | paid | partial | unpaid`, and it is `overdue` when `outstanding > 0 && due_date < today`. It is never stored.
6. **The server recomputes all totals** from the lines, using pure functions in `@billy/core`. A client-sent total is ignored, or rejected if it disagrees.
7. **Business dates** are Postgres `date` in the `Asia/Jakarta` timezone. Audit timestamps are `timestamptz`.
8. **Line cost snapshot.** The **cost of a product as of a date** is the net unit cost (`round(line_total / qty)`) of its latest non-voided purchase line dated on or before that date, falling back to `products.cost_price` when there is none (`costAsOf` in `apps/api/src/lib/cost-as-of.ts`). Every sales line stores `unit_cost` = the cost as of the invoice date; every POS line stores the cost as of the sale's own business date, so an offline sale synced after a newer purchase keeps the cost that applied when it was sold. Every purchase posting sets `products.cost_price` to the line's net unit cost (latest-cost method); voiding a purchase resets it to the net unit cost of the latest remaining non-voided purchase, and keeps the current value when none remains. Sales revenue is `subtotal - discount_amount` (net of the document discount, before PPN) and gross profit is that minus `sum(qty * unit_cost)`.

## Tables

```
users            id, username (unique), name, password_hash, role: admin|staff|kasir, active, created_at
sessions         id, token_hash (unique), user_id, expires_at, created_at
settings         id = 1 (single row): shop_name, address, phone, whatsapp, invoice_bank_text,
                 invoice_signer, receipt_footer, pos_device_code (e.g. "K1")

categories       id, name (unique), description
products         id, code (unique, nullable), barcode (unique, nullable), name, variant, unit,
                 category_id, sell_price, cost_price, min_stock, active, created_at, updated_at
contacts         id, code (unique), name, kind: customer|supplier|employee|other, phone, email,
                 address, tax_id, payment_terms_days, active, created_at, updated_at
accounts         id, code (unique), name, kind: cash|bank|ewallet, active, created_at

cash_entries     id, account_id, date, direction: in|out, amount (>0), category, source_type,
                 source_id, note, created_by, created_at
                 category: sale|purchase|expense|transfer|other_in|other_out|reversal
                 source_type: sales_payment|purchase_payment|pos_sale|expense|transfer|manual
stock_movements  id, product_id, date, qty (integer, signed), reason: purchase|sale|pos|adjustment|reversal,
                 unit_cost, source_type, source_id, note, created_by, created_at

sales_invoices   id, number (unique), customer_id, date, due_date, terms_days, discount_kind: none|percent|amount,
                 discount_value, subtotal, discount_amount, total, note, created_by, created_at,
                 voided_at, voided_by, void_reason
sales_lines      id, invoice_id, position, product_id, note, qty, unit_price, discount_amount, line_total, unit_cost

purchase_invoices id, number (unique), supplier_invoice_number, supplier_id, date, due_date, terms_days,
                 discount_kind, discount_value, subtotal, discount_amount, tax_rate_bp (basis points, PPN),
                 tax_amount, total, note, created_by, created_at, voided_at, voided_by, void_reason
purchase_lines   id, invoice_id, position, product_id, note, qty, unit_cost, discount_amount, line_total

payments         id, direction: receivable|payable, sales_invoice_id | purchase_invoice_id (exactly one, CHECK),
                 account_id, date, amount (>0), method: cash|transfer|qris|giro, proof_url, note,
                 created_by, created_at, voided_at, voided_by, void_reason
expenses         id, number (unique), date, account_id, category (free text, suggested list), description,
                 amount (>0), proof_url, created_by, created_at, voided_at, voided_by, void_reason
transfers        id, date, from_account_id, to_account_id (≠ from), amount (>0), note, proof_url,
                 created_by, created_at, voided_at, voided_by, void_reason
invoice_bundles  id, number (unique), customer_id, date, note, created_by, created_at, voided_at
bundle_invoices  bundle_id, invoice_id (PK both)

pos_sales        id (client UUIDv7), number (unique, e.g. K1-261113-0001), device_code, sold_at (timestamptz),
                 date, cashier_id, customer_id (nullable), subtotal, discount_kind, discount_value,
                 discount_amount, total, method: cash|qris|transfer, account_id, tendered, change,
                 created_at (server receive time), voided_at, voided_by, void_reason
pos_lines        id, sale_id, position, product_id, note, qty, unit_price, discount_amount, line_total, unit_cost

document_sequences prefix + period (PK), last_value
```

Manual cash rows ("terima uang" and other money out) are `cash_entries` with `source_type = manual` and category `other_in` or `other_out`.

## Side effects per command

| Command | Writes |
|---|---|
| Create sales invoice | invoice + lines, stock movement `sale` (−qty) per line |
| Void sales invoice | refused while non-voided payments exist; otherwise reversal stock movements |
| Record sales payment | payment + cash entry `in` / `sale`. Rejected if amount > outstanding. |
| Void payment | reversal cash entry (`out`, category `reversal`) |
| Create purchase invoice | invoice + lines, stock movement `purchase` (+qty), update `products.cost_price` |
| Void purchase invoice | refused while non-voided payments exist; otherwise reversal stock movements, `products.cost_price` recomputed (rule 8) |
| Record purchase payment | payment + cash entry `out` / `purchase` |
| Create expense | expense + cash entry `out` / `expense` |
| Transfer | transfer + cash entry `out` on from + `in` on to, both category `transfer` |
| Manual cash entry | cash entry `other_in` / `other_out` |
| POS sale (idempotent by id) | sale + lines, stock movement `pos` (−qty), cash entry `in` / `sale` for `total`. `cashier_id` is the signed-in user; admin or staff uploading a sale another cashier queued offline record it under the payload's `cashierId` (an existing user). A kasir uploads only their own queued sales; the device keeps another cashier's until that cashier signs in again. |
| Void POS sale | reversal stock movements + reversal cash entry |
| Stock adjustment | stock movement `adjustment` (signed qty, required note) |
| Create tukar faktur | bundle + invoice links. Only the customer's non-voided invoices with outstanding > 0. |

Every command runs in one database transaction.

## Document numbers

The server-numbered prefixes are SO (sales), PO (purchase), TF (tukar faktur), and BY (biaya). The format is `{PREFIX}-{YYMMDD}-{NNNN}`. The period is the business date and the counter comes from `document_sequences` inside the transaction. A surat jalan reuses the sales number with an `SJ-` prefix.

The POS uses `{device_code}-{YYMMDD}-{NNNN}`, allocated **on the client** from a per-device counter stored in IndexedDB. A unique constraint on `pos_sales.number` guards against duplicates.

## Roles

| Role | Can use |
|---|---|
| admin | everything, plus users and settings |
| staff | everything except users and settings |
| kasir | `POST /api/pos/sales`, its own POS history, reprint, product and account lookup for the POS. Nothing else. Enforced by API middleware. |

## Code layout and patterns

```
packages/core/src/
  money.ts            Rupiah (exists)
  ids.ts              uuidv7()
  dates.ts            today in Asia/Jakarta, add days, format
  invoice.ts          computeLines/computeTotals (discount + PPN), pure
  status.ts           deriveInvoiceStatus
  numbering.ts        formatDocNumber, nextPosNumber
  schemas/*.ts        zod input schemas per module (shared by API validation and web forms)
packages/db/src/
  schema.ts           Drizzle tables above
  client.ts           createDb(): PGlite when DATABASE_URL is unset (dev and tests), node-postgres otherwise (Neon pooled URL)
  migrations/         drizzle-kit output
apps/api/src/
  app.ts              composes module routers under /api
  auth/               sessions, password hashing (node:crypto scrypt), requireRole middleware
  modules/<name>/     routes.ts (Hono + zod validator) and service.ts (db transactions calling core rules)
apps/web/src/
  router.tsx          TanStack Router, code-based routes (no generated route tree)
  routes/<module>/    pages per module
  components/ui/      shared primitives styled with the tokens in index.css
  lib/api.ts          typed Hono client + TanStack Query helpers
```

- **Validation lives at the boundary.** Zod validates in the route. Services trust their typed input.
- **Business rules are pure functions in `@billy/core`**, tested with literal expected values.
- **API tests** run against an in-memory PGlite with the migrations applied. They call `app.request(...)` the way the web client does.
- **List endpoints** return typed JSON rows (never HTML) with server-side pagination: `?q=&page=&pageSize=` returns `{ rows, total }`.
