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
users            id, username (unique), name, password_hash, role: admin|staff|kasir, active,
                 approval_pin_hash (admins only, never sent to a client), created_at
sessions         id, token_hash (unique), user_id, expires_at, created_at
settings         id = 1 (single row): shop_name, address, phone, whatsapp, invoice_bank_text,
                 invoice_signer, receipt_footer, pos_device_code (e.g. "K1"),
                 kasir_max_discount_bp (default 500), allow_below_cost (default false),
                 cash_difference_threshold (default 10000), open_time (time, default 07:00),
                 close_time (time, default 17:00). The last three feed the watchdog and are never
                 sent to the Kasir device.

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
                 unit_cost, source_type (sales_invoice|purchase_invoice|pos_sale|stock_opname), source_id,
                 note, created_by, created_at
stock_opnames    id, number (unique, OP-YYMMDD-NNNN), date, category_id (null = all active products), note,
                 status: draft|posted, created_by, created_at, posted_by, posted_at
stock_opname_lines opname_id + product_id (PK), counted_qty (≥0), system_qty and unit_cost (both set at
                 posting). Only entered lines exist.

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
quotations       id, number (unique, Q-YYMMDD-NNNN), customer_id, date, valid_until, lines (jsonb, as on
                 pos_drafts), subtotal, discount_kind, discount_value, discount_amount, total, note,
                 status: draft|sent|accepted|rejected, invoice_id (unique, the faktur it became),
                 created_by, created_at

pos_sales        id (client UUIDv7), number (unique, e.g. K1-261113-0001), device_code, sold_at (timestamptz),
                 date, cashier_id, customer_id (nullable), subtotal, discount_kind, discount_value,
                 discount_amount, total, method: cash|qris|transfer, account_id, tendered, change,
                 shift_id (null only on sales from before shifts), revision_of (unique; the nota a revisi
                 replaced), print_count (1 = the checkout receipt), created_at (server receive time),
                 voided_at, voided_by, void_reason
pos_drafts       id, number (unique, S-YYMMDD-NNNN), date, created_by, customer_id, lines (jsonb: product_id,
                 qty, unit_price, discount_amount, note), subtotal, discount_kind, discount_value,
                 discount_amount, total, status: open|paid|cancelled, print_count, sale_id (unique, the POS
                 sale that paid it), created_at, updated_at, cancelled_at, cancelled_by, cancel_reason
cash_shifts      id (client UUIDv7), cashier_id, device_code, account_id (the cash drawer), opened_at (device
                 time), opening_float (≥0), closed_at, counted_cash, expected_cash, difference (counted −
                 expected), close_note. One open shift per cashier per device (partial unique index
                 `cash_shifts_one_open`).
pos_lines        id, sale_id, position, product_id, note, qty, unit_price, discount_amount, line_total, unit_cost

document_sequences prefix + period (PK), last_value

approvals        id, kind: void|discount|below_cost|revisi_lower|refund|cancel_printed_draft|foreign_or_past_revisi,
                 status: pending|approved|rejected|used|expired, method: pin|remote, requested_by,
                 device_code, subject (jsonb: exactly what was approved), summary, decided_by, decided_at,
                 used_at, created_at, expires_at (remote: 10 minutes)
audit_events     id, at, actor_id (null only for a failed login with an unknown username), actor_role,
                 source: web|kasir|kasir_offline|system, device_code, action (a key of `auditActions`
                 in @billy/core), entity_type, entity_id, summary, before, after (changed fields only),
                 reason, approval_id. Append-only: a trigger rejects UPDATE, DELETE and TRUNCATE.
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
| Revisi POS sale (idempotent by the new id) | original voided; reversal stock movements for its lines; new sale + lines with `revision_of`, stock movement `pos` (−qty); one cash entry for the difference only (see below) |
| Reprint POS sale | `print_count + 1` |
| Create / edit nota sementara | draft row only. No stock, no money. |
| Pay nota sementara | the POS sale as above, then the draft becomes `paid` with `sale_id` |
| Cancel nota sementara | status `cancelled` with reason. Never deleted. |
| Create penawaran | quotation row only. No stock, no money, no piutang. |
| Jadikan faktur | sales invoice as above with the quote's lines; quotation `accepted` with `invoice_id` |
| Open shift (idempotent by id) | shift row. Refused while the cashier has another open shift on the device. |
| Close shift (idempotent) | sets `closed_at`, `counted_cash`, and the server-computed `expected_cash` and `difference` (see Shifts) |
| Stock adjustment | stock movement `adjustment` (signed qty, required note) |
| Start stok opname | opname row (draft) |
| Save opname counts | upserts the entered lines; a cleared line is removed. Draft only. |
| Post stok opname (admin only) | per line, `system_qty` = the stock now and `unit_cost` = the product's cost price; one `adjustment` movement (`source_type = stock_opname`) per line whose count differs; status `posted`. Posted is read-only. |
| Create tukar faktur | bundle + invoice links. Only the customer's non-voided invoices with outstanding > 0. |

Every command runs in one database transaction, and writes its `audit_events` row in that same transaction (`audit()` in `apps/api/src/lib/audit.ts`), so a change without its log row cannot commit. Logins, failed logins and logouts are logged too. A Kasir sale received more than 2 minutes after `sold_at` is logged with source `kasir_offline`; the legacy importer logs with source `system`.

## Limits and approvals

Admin is never limited. For everyone else the server refuses with 403 (body `{ error, approval: { kind } }`, the message names the limit):

- a POS sale or sales invoice whose line and document discounts together pass `kasir_max_discount_bp` of the gross;
- a POS sale with a line priced under qty × unit cost, unless `allow_below_cost`;
- every POS void;
- cancelling a nota sementara that has been printed (`cancel_printed_draft`);
- a revisi that lowers the total (`revisi_lower`), or revises another cashier's nota or a nota from an earlier business date (`foreign_or_past_revisi`);
- converting a penawaran with a line whose net price is under qty × the product's selling price or its cost (`below_cost`).

An action that breaks several rules needs one approval. Its kind is the first rule broken, and its summary names all of them. The subject binds the exact document: a revisi's subject holds the original id and the new nota's id, number, total, discount and lines; a quote conversion's holds the quote id, the faktur date and the quote's lines and total.

The action passes when it carries `approval: { pin }` (any active admin's PIN; recorded as a `used` approval in the action's transaction; 5 wrong PINs lock PIN approval for that user for 15 minutes) or `approval: { id }` of a remote request the admin approved. A remote approval is spent by one conditional update that also requires the same requester, `approved`, unexpired, and a subject equal (jsonb) to the action's own, so it fits one action once.

## Shifts

Everyone selling on the Kasir screen, admin included, sells inside a shift. A POS sale must carry the `shift_id` of an open shift of its cashier; otherwise it is refused (400 without one, 422 for an unknown or another cashier's shift, 409 for a closed one).

The device generates the shift id and queues the open and the close in the same outbox as its sales, so the server receives open, then the sales, then the close, even after an offline stretch. The server answers a replayed open or close with the stored result.

At close the server computes:

```
expected_cash = opening_float
              + cash POS sales with this shift_id (a revisi counts its total − the replaced nota's total)
              − cash POS sales voided by the shift's cashier between opened_at and closed_at,
                except a nota voided by a revisi
              + other cash entries on the drawer account between opened_at and closed_at (in − out)
```

A void counts against the voider's open shift, not the shift that sold it, because the money leaves the drawer in front of the voider. QRIS and transfer sales never count. The window uses the device's `opened_at` and `closed_at` and the server's `voided_at` and `created_at`. When two cashiers' shifts share one drawer account at the same time, a manual cash movement counts in both.

The close answers only `{ id, closedAt }`. A kasir never receives `expected_cash` or `difference`: they appear only in the admin-only Shift report (`GET /api/shifts`) and in the `shift.close` audit event.

## Nota sementara, revisi and penawaran

All three are online only. The device never queues them.

**Nota sementara.** A Kasir cart saved on the server as `S-YYMMDD-NNNN`, shared by every device. Open drafts can be reopened on any device and edited without approval; each edit writes `pos.draft.update` with the changed fields before and after. Printing counts `print_count` and prints "NOTA SEMENTARA / BUKAN BUKTI PEMBAYARAN" without payment rows. Paying posts a normal POS sale to `POST /api/pos/drafts/:id/pay`, numbered on the device and checked against the payer's open shift and every sale limit; in the same transaction the draft takes the paid cart's content (an audited edit if it changed) and turns `paid`. A draft paid or cancelled meanwhile rolls the sale back with 409. No stock is held while a draft is open (assumption, see the plan).

**Revisi.** `POST /api/pos/sales/:id/revise` takes the new nota (device-numbered, server-timed) and a reason. The original is voided with reason `Revisi <new number>: <reason>` and the new nota links to it with `revision_of`; Riwayat Kasir shows "Direvisi" and "revisi dari …". Only the difference changes hands:

| Difference | Cash entry on the new nota | Method and account of the new nota |
|---|---|---|
| higher | `in` / `sale` for the difference | as chosen by the cashier |
| lower | `out` / `reversal` for the difference | always cash, the reviser's drawer |
| equal | none | as chosen |

The original's own cash entry stays where it was paid, so a QRIS nota revised in cash leaves the QRIS money in the QRIS account. `tendered` is what was handed over for the difference and `change = tendered − difference`, so a refund shows as change. A later plain void of a revisi nota reverses its full total from its account, like any void. Reprints (`POST /api/pos/sales/:id/print`) count `print_count` and print "SALINAN"; a reprint made offline prints "SALINAN" but is not counted.

**Penawaran.** `Q-YYMMDD-NNNN`, back office only. `expired` is derived (draft or sent with `valid_until` before today) and never stored; an expired quote cannot be converted. A quote is in no list total, report or Overview figure, because those read only invoices and POS sales. "Jadikan faktur" creates the sales invoice through the same code as a new faktur, in one transaction with the quote's `accepted` status, and the invoice detail returns `quotation: { id, number }`.

## Stok opname

Admin or staff starts an opname for all active products or one category and enters counted quantities; a product left blank does not count. The draft is saved on the server and can be continued on any device. The screen shows the live system stock, but posting takes the stock at that moment, so sales during the count are accounted for. Posting is admin only and runs in one transaction with its `stock.opname.post` audit event ("Opname OP-… · 12 barang selisih · −Rp 340.000"). Differences are valued at the product's cost price at posting.

## Watchdog

`GET /api/watchdog?from&to` (admin only, at most 93 days) computes red flags on read from the tables they are about; there is no background job. Each flag has a type, severity (`high` | `medium`), who, when, one Indonesian line, and a target (a POS sale, a faktur, an opname, the Shift report filtered to a cashier and day, or Log Aktivitas filtered to a person, action and day). Thresholds that are not settings live in `WATCHDOG` in `@billy/core`.

| Flag | Rule |
|---|---|
| voids, revisi, refunds | per cashier (not admin) per business day, from `audit_events`: count > max(3, 2 × the median of that cashier's daily counts over the prior 30 calendar days, zero days included). A refund is a revisi that lowered the total. |
| shift_difference | a closed shift with \|difference\| ≥ `cash_difference_threshold`. High when cash is missing. |
| below_cost | a non-voided POS sale or faktur by a non-admin with a line under qty × its stored `unit_cost`. A faktur from a penawaran names the quote. |
| discount_near_cap | the same documents with line and document discounts at or within 0,5% of `kasir_max_discount_bp` (high when over it, which needed approval). |
| draft_open_after_close | a nota sementara still open after `close_time` of its business date. |
| draft_cancelled_printed | a printed nota sementara cancelled by a non-admin. |
| outside_hours | per person per day, any audited action outside `open_time`–`close_time` (Asia/Jakarta), except the importer's `system` events. |
| failed_logins, pin_lockout | ≥3 failed logins for one username on one day; every PIN lockout. |
| clock_tampering | a POS sale or shift open timed more than 5 minutes after the server received it, or a shift opened before the same cashier's previous shift on that device closed (one cashier's events leave a device in order). |
| opname_difference | a posted opname whose differences at cost add up to ≥ Rp 100.000 ignoring sign. High when the net is a loss. |

Every query is bounded by an indexed date: `audit_events.at`, `pos_sales.date`, `sales_invoices.date`, `cash_shifts.opened_at`, `stock_opnames.posted_at`. The Overview card and the bell share one request for the last 7 days. `GET /api/watchdog/daily?date` is the Ringkasan harian: the day's flags and, per person, voids, revisi, refunds, discounts given (line + document, non-voided) and the sum of shift differences.

## Document numbers

The server-numbered prefixes are SO (sales), PO (purchase), TF (tukar faktur), BY (biaya), S (nota sementara), Q (penawaran) and OP (stok opname). The format is `{PREFIX}-{YYMMDD}-{NNNN}`. The period is the business date and the counter comes from `document_sequences` inside the transaction. A surat jalan reuses the sales number with an `SJ-` prefix.

The POS uses `{device_code}-{YYMMDD}-{NNNN}`, allocated **on the client** from a per-device counter stored in IndexedDB. A unique constraint on `pos_sales.number` guards against duplicates.

## Roles

| Role | Can use |
|---|---|
| admin | everything, plus users, settings, Log Aktivitas, the Shift report, the watchdog and Ringkasan harian, posting a stok opname, and deciding approvals |
| staff | everything except users and settings |
| kasir | `POST /api/pos/sales`, opening and closing its own shifts, its own POS history, reprint, void of its own sales with an admin's approval, revisi (another cashier's or a past day's nota only with approval), every nota sementara, remote approval requests, product and account lookup for the POS. Nothing else. Enforced by API middleware. |

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
