# UI/UX direction (draft, 2026-11-12)

The reference is a clean analytics dashboard: a light neutral shell, a white main panel, a strip of KPIs, a trend chart with labels at the end of each line, a ranked list, and a "next best action" card. The mock is `docs/design/mock-dashboard.html` and its render is `mock-dashboard.png`. All numbers and names in the mock are fake.

## Visual language (taken from the reference)

- **Monochrome first.** The palette is ink `#111113`, muted `#71717a`, faint `#a1a1aa`, lines `#e8e8ea`, the shell `#f4f4f5`, and white panels. Color carries meaning only: green for up, red for down or overdue, amber for warning. Brand color is not used decoratively.
- **Type.** Inter (or Geist), with `tabular-nums` on every number. Big KPI numbers are weight 500. The fraction and unit are grey (`Rp 412,6 jt`), which shows the reference's grey-decimal trick.
- **Shape.** Radius 12px on cards and 8px on controls. 1px borders, no shadows. Spacing between cards is 14–16px.
- **Charts.** Few series. The primary series is solid ink and the secondary is grey. Labels go at the end of each line, not in a legend box. Gridlines are faint and there is no chart border.
- **Copy.** Bahasa Indonesia throughout with a fixed glossary (below). Money is shown as `Rp 1.234.567`, shortened to `jt` / `M` in KPIs, with the full value on hover.

## Information architecture

| Sidebar group | Items | Replaces in legacy |
|---|---|---|
| top | Search (⌘K), **Buka Kasir** (F2, black primary button, like "Ask AI") | none |
| Umum | Ringkasan, Perlu Tindakan (badge) | Dashboard |
| Transaksi | Penjualan, Pembelian, Biaya, Tukar Faktur, Riwayat Kasir | the same items |
| Keuangan | Kas & Bank, Piutang, Hutang | Akun Rekening, Laporan Debit Kredit, Hutang links |
| Persediaan | Produk, Mutasi Stok, Kontak | Master Produk, Kategori, Kontak |
| bottom | **Sync status card**, Pengaturan (users, categories, accounts, document numbering, print templates), user card | Users |

The sync status card replaces the reference's "Getting started" card. It always shows Online or Offline, the pending upload count, the last sync time, and the device. A user should never have to wonder whether data is saved.

"Perlu Tindakan" is the reference's Action Center applied to the shop. It lists overdue receivables, supplier bills due within 7 days, negative stock, sync issues, and cash in the shop that should be deposited.

## Dashboard (Ringkasan)

1. **Header.** The title, the period sentence, and a pill on the right showing the total cash and bank balance.
2. **Filter row.** Period, account, and category, plus "Data per <timestamp>" on the right. That stamp matters when the device is offline.
3. **KPI strip (5).** Penjualan (invoice vs POS split bar), Laba kotor (needs item cost), Arus kas bersih, Piutang terbuka (overdue share in red), and Hutang jatuh tempo ≤7 hari. Each shows a delta against the previous period. Every KPI labels its own time window, which fixes the legacy cards that mixed windows.
4. **Arus kas chart.** Money in vs money out weekly, with 12-week and 6-month toggles.
5. **Saldo per akun.** A ranked list with the weekly change. It replaces the reference's "Visibility rank".
6. **Tindakan berikutnya.** The top item from Perlu Tindakan with one primary action, for example "Buat tukar faktur".

## Other screens (direction, to be mocked next)

- **Lists** (Penjualan, Pembelian, Produk…): the same filter row, a search that fires as you type, status as small tags (Lunas / Sebagian / Belum bayar / Telat), right-aligned tabular money, a sticky header, and row click to open a side sheet. Keyboard j/k moves between rows.
- **Invoice form:** a document layout, not a grid of inputs. The header (customer, date, terms) sits on top. Below it is a line table where you type a product name, press Enter for qty, and Enter for the next line. A totals panel on the right is computed and read-only, so computed values never look editable. Per-line discount sits behind a "+ diskon" toggle and does not show on every line.
- **Kasir (POS):** a full-screen mode separate from the dashboard shell. The search or barcode field is always focused, with the cart on the left and the totals plus payment on the right. Large touch targets. F-keys handle payment method and Enter-Enter completes the sale. The offline state is visible but quiet. The receipt prints automatically.
- **Detail side sheet:** document header, lines, payments timeline, and actions (Bayar, Cetak faktur, Surat jalan, Batalkan).

## Glossary (fixed terms)

Penjualan, Pembelian, Biaya, Pelanggan, Pemasok, Piutang, Hutang, Jatuh tempo, Lunas, Belum bayar, Sebagian, Telat, Dibatalkan, Kas & Bank, Mutasi stok, Tukar faktur, Surat jalan. The legacy spellings ("Suppliyer", "Excell") go away. A void shows as "Batalkan" on its button and "Dibatalkan" as its status; the code, API paths and database keep the word `void`.

## Decisions (2026-11-12)

- **Themes.** Light and dark. Every color is a CSS token on `:root`, redefined under `[data-theme=dark]`. The default follows the OS, and a toggle sits in the top bar.
- **Kasir role.** The cashier sees only the Kasir screens: the POS, its own receipt history, and a reprint. There is no dashboard shell and no finance data. The server enforces this, and hiding menu items alone does not count.

## Kasir (POS) spec

The mock is `mock-kasir.html`. The renders are `mock-kasir-light.png` (search open) and `mock-kasir-dark.png` (cart view). The target screen is 1366×768, a typical shop PC.

- **Layout.** A slim top bar holds the receipt number, the customer (default "Umum"), the sync state, the shift, and the theme toggle. Under it, the cart is on the left and the payment panel is on the right. There is no sidebar.
- **Search.** The search field is always focused and doubles as the barcode-scanner input, because a scanner acts as a keyboard. Matches fire as you type and show stock, with low stock in amber. Enter adds the item and Shift+Enter adds it and jumps to qty.
- **Cart.** The selected row responds to `+`/`−` for qty, `D` for discount, `N` for a note, and `Del` to remove it. The note holds the **tinting colour code**, which prints on the receipt with "tidak bisa retur".
- **Payment.** Line discounts are shown, and the transaction discount sits behind F4. The total is the largest text on screen. Methods are F5 Tunai, F6 QRIS, and F7 Transfer, and each method maps to a cash or bank account, shown as "masuk ke Kas Toko". Quick-tender chips are Uang pas plus 3 rounded amounts. The change is shown in large green text. Enter pays and prints.
- **Global keys.** F8 holds (parks) a sale, F9 opens history, F10 reprints, and Ctrl+Del cancels.
- **Offline.** An amber chip shows the pending count. Selling never blocks. The receipt number comes from the device series (`K1-…`).
- **Shift.** The shift opens with an opening cash amount and closes with a cash count, so cash in the drawer can be reconciled against Kas Toko. This screen is not mocked yet.

## Open questions

1. Which number matters most to the owner each morning? That number becomes the first KPI.
2. Does the shop use a barcode scanner today? Are there barcodes on the products?
3. Is a shift open/close with a cash count wanted?
