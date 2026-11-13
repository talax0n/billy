# Legacy E-Jurnal import

Copies the live legacy app (acitech.web.id/e-jurnal) into a fresh local database. Two steps: download, then import.
The download is read-only (GET pages and DataTables list POSTs). Everything it saves goes to `.legacy/`, which is
gitignored because it holds real customer and supplier data.

## 1. Download

Log in with curl to get a cookie jar (credentials never go in a file in the repo):

```bash
curl -s -c /tmp/jar.txt -X POST https://acitech.web.id/e-jurnal/login/cek_login \
  -H 'X-Requested-With: XMLHttpRequest' --data-urlencode "username=…" --data-urlencode "password=…"
export LEGACY_JAR=/tmp/jar.txt

node tools/legacy/dump-lists.ts                  # every list endpoint, incl. the jurnal ledger (minutes)
node tools/legacy/dump-details.ts tukar_faktur 1  # detail pages (hours for the full history);
node tools/legacy/dump-details.ts penjualan 2     # newest first, resumable: rerun to continue
node tools/legacy/dump-details.ts pembelian 2
node tools/legacy/dump-details.ts kasir 5
```

The last argument is the number of parallel requests. Keep it low: the legacy app is the shop's production system.

## 2. Import

```bash
rm -rf .data/legacy
pnpm --filter @billy/api import:legacy      # builds .data/legacy (about a minute for the full history)
pnpm dev:legacy                             # runs the app on it; sign in as admin / admin12345
```

The importer (`apps/api/src/legacy-import/`) calls the same services as the API, so totals, stock and cash follow
the app's rules. Rows a rule rejects, and legacy totals that disagree with the recomputed ones, are listed in
`.legacy/import-errors.jsonl`.

## How legacy data is mapped

- Products are matched to document lines by name; a "(…)" suffix is the tint code and becomes the line note.
  A name the product list no longer has becomes a new product.
- Line discount = quantity × price − the printed line total. Document discount = subtotal + PPN − total, or the
  discount percentage when the legacy total is corrupt. The legacy "Total Diskon" and "Jumlah Diskon" fields are
  unreliable and are not used.
- Payments come from each invoice's payment history; a payment above what is still owed is capped and logged.
- Cashier receipts take their account from the jurnal ledger. Receipt numbers become `C-YYMMDD-NNNN`; a repeated
  legacy number gets two extra digits.
- "Terima uang" and "transfer uang" ledger rows become manual cash entries (the ledger does not name a transfer's
  destination).
- Stock: one adjustment per product at the end sets it to the legacy stock count.
- Shop address, phone, WhatsApp and receipt footer come from `.legacy/shop.json` (keys `address`, `phone`, `whatsapp`, `receiptFooter`), copied by hand from the legacy Pengaturan page; without it they import empty.
- Legacy users are not imported (their passwords are unknown); sign in as admin and add users in Pengaturan.
