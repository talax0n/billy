# Anti-fraud controls plan

The owner (admin) must be able to see and prove what every staff member and cashier did, and the riskiest actions must not happen without the owner's approval. This plan adds those controls in four phases. Each phase ships on its own, with its own tests, before the next one starts.

Decisions from the owner's side (2026-11-13):

- **Approvals** happen in two ways. Admin types a PIN on the Kasir screen, or approves a request remotely from the bell.
- **Strict limits** apply to everyone except admin. A Kasir discount is at most 5% per nota. Nothing is sold below cost. Every void, every revisi that lowers the total, and every refund needs approval.
- **Shifts** are per cashier, several a day, each closed with a blind cash count.
- **Revisi** can be done by a kasir or an admin. A lower total is refunded from the cash drawer *for now* (revisit before Phase 3 ships).
- **Penawaran** converts to a faktur only.
- **Nota sementara** stock rule is still open: hold stock on the open nota, or take it at payment. Ask the client before Phase 3.

## Phase 1. Audit log, limits, and approvals

### Audit log

One append-only table. Every service function that changes data writes its event in the same transaction as the change, so a change without a log row cannot exist.

```
audit_events
  id            uuid
  at            timestamptz          server time
  actor_id      -> users             who did it
  actor_role    user_role            role at the time
  source        web | kasir | kasir_offline | system
  device_code   text?                Kasir device, e.g. K1
  action        text                 from a typed registry in @billy/core, e.g. pos.sale.void
  entity_type   text                 e.g. pos_sale
  entity_id     text
  summary       text                 one readable line, e.g. "Void C-261113-0410 Rp 210.000"
  before        jsonb?               changed fields only
  after         jsonb?
  reason        text?
  approval_id   -> approvals?        when the action needed approval
```

- No API updates or deletes it. A database trigger rejects `UPDATE` and `DELETE` on the table, so even direct SQL cannot rewrite history.
- Logged actions include sales, voids, payments, faktur and purchase edits, stock adjustments, product price and cost changes, expenses, cash entries and transfers, users and roles, settings, logins, failed logins and logouts.
- Offline Kasir sales are logged at sync with `source = kasir_offline` and the device's sale time in `after`.

**Log Aktivitas** is an admin-only page with filters for person, action, date and nota number. Each row shows the summary, and opening it shows before and after side by side.

### Limits

Limits live as typed columns on `settings`, editable by admin in Pengaturan:

```
kasir_max_discount_bp      500    (5%) per nota, line and document discounts combined
allow_below_cost           false
```

The server enforces every limit. The UI only explains it. A request over a limit without a valid approval fails with 403 and a message that names the limit.

### Approvals

```
approvals
  id            uuid
  kind          void | discount | below_cost | revisi_lower | refund | cancel_printed_draft | foreign_or_past_revisi
  status        pending | approved | rejected | used | expired
  method        pin | remote
  requested_by  -> users
  device_code   text?
  subject       jsonb      what exactly is approved: sale id, amount, discount, lines
  decided_by    -> users?
  decided_at    timestamptz?
  created_at, expires_at   (remote requests expire after 10 minutes)
users.approval_pin_hash    text?   admins only, set in Pengaturan, 6 digits, hashed like passwords
```

- **PIN.** The Kasir sends the admin's PIN with the action. The server checks it and records an approval with `method = pin` and `status = used` in the same transaction. Five wrong PINs lock PIN approval for 15 minutes and are logged.
- **Remote.** The Kasir creates a `pending` approval. Admin sees it in the bell and approves or rejects it. The Kasir screen polls, then retries the action with the approval id. The server marks the approval `used` in the action's transaction, and only when the subject matches the action. An approval for a Rp 50.000 discount cannot be spent on a Rp 500.000 one.
- **Offline.** An action that needs approval is blocked while offline. PIN hashes are never sent to the device, because a 6-digit hash on a cashier PC can be cracked in seconds.

## Phase 2. Shifts and blind cash count

Status: built (2026-11-13), except the nota sementara rule, which waits for Phase 3. How expected cash is computed is in [the data model](../architecture/data-model.md#shifts).

```
cash_shifts
  id, cashier_id, device_code, account_id (the cash drawer account)
  opened_at, opening_float
  closed_at?, counted_cash?, expected_cash?, difference?, close_note?
pos_sales.shift_id -> cash_shifts
```

- A Kasir must open a shift with the starting float before the first sale. One open shift per cashier per device.
- Closing asks for the counted cash *without showing the expected amount*. The server computes expected cash from the float, cash sales, cash refunds and cash moved in or out during the shift, then stores the difference.
- The Kasir sees only "Shift ditutup". Admin sees the expected, counted and difference in Log Aktivitas and in a Shift report. Closing warns about the cashier's open nota sementara instead of refusing (Phase 3).

## Phase 3. Client features with controls

Status: built (2026-11-13). The rules, numbers and cash math are in [the data model](../architecture/data-model.md#nota-sementara-revisi-and-penawaran).

Open assumptions, to confirm with the owner:

- **Nota sementara holds no stock.** The owner has not answered the stock question, so stock moves only at payment, like any sale. Two open notas can promise the same last can of paint.
- **A shift closes even with open nota sementara.** The close is queued offline like every shift event, so the server cannot block it. Instead the close dialog lists the open notas the cashier made. They stay open for any cashier to pay or cancel.
- **A lower revisi is refunded in cash from the reviser's drawer**, whatever the original was paid with. A higher revisi collects the difference with the method the cashier picks.
- **Parkir keranjang stays.** It is the offline, device-only hold. Nota sementara is the online, shared one.

- **Nota sementara.** A server-side, numbered `S-` document, shared across devices and printable as "NOTA SEMENTARA, BUKAN BUKTI PEMBAYARAN". It can't be deleted. Cancelling needs a reason, and approval once it has been printed. Paying converts it to a normal `C-` nota.
- **Revisi nota kasir.** It voids the original and issues a new nota linked to it. A higher total collects the difference. A lower total refunds from the shift's cash drawer and needs approval. Revising another cashier's nota, or a past day's nota, also needs approval. Every print is counted, and reprints say "SALINAN".
- **Penawaran harga.** A `Q-` document with lines, prices and a valid-until date. It moves no stock and is excluded from totals. Converting it to a faktur copies the lines. A quote below cost or below the normal selling price needs approval at conversion.

## Phase 4. Watchdog

Status: built (2026-11-13). The rules and thresholds are in [the data model](../architecture/data-model.md#watchdog), stok opname [there too](../architecture/data-model.md#stok-opname). Flags are computed on read, since the serverless deploy has no cron. The Overview card and the bell show today's flags, and Ringkasan harian is the daily summary, without email.

Red flags show on the Overview and in the bell, plus a daily summary for admin:

- voids, revisi and refunds per cashier per day above normal
- shift cash differences
- sales or quotes below cost, discounts at the limit
- nota sementara open past closing or cancelled after printing
- activity outside opening hours, repeated failed logins and PIN attempts

A periodic stock count (opname) compares counted stock against the system, which catches goods that left without a sale.

## How each phase is checked

- API tests cover every rule: a limit breached without approval returns 403, a valid approval is spent exactly once, and an approval for one subject can't be used for another.
- An e2e flow drives the Kasir screen through a blocked discount, a PIN approval and a remote approval.
- A check confirms the audit table rejects `UPDATE` and `DELETE`.
