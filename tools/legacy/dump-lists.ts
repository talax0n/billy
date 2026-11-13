/** Dumps every legacy DataTables list endpoint to .legacy/lists/<name>.json (raw rows). Read-only. */
import { mkdirSync, writeFileSync } from "node:fs";
import { OUT, request, sleep } from "./session.ts";

const lists: Record<string, string> = {
  users: "master/users/get_ajax_user",
  kontak: "master/kontak/get_ajax_kontak",
  kategori: "master/kategori/get_ajax_kategori",
  produk: "master/produk/get_ajax_produk",
  akun: "book/kasbank/get_ajax_akun",
  penjualan: "transaksi/penjualan/get_ajax_penjualan",
  pembelian: "transaksi/pembelian/get_ajax_pembelian",
  biaya: "transaksi/biaya/get_ajax_biaya",
  tukar_faktur: "transaksi/tukar_faktur/get_ajax_tukar_faktur",
  kasir: "kasir/report_kasir/get_ajax_report_kasir",
  // The money ledger: one row per movement (document no., kind, account, date, debit, credit).
  jurnal: "transaksi/jurnal/get_ajax_jurnal",
};
const only = process.argv.slice(2);
const PAGE = 1000;
mkdirSync(`${OUT}lists`, { recursive: true });

for (const [name, path] of Object.entries(lists)) {
  if (only.length && !only.includes(name)) continue;
  const rows: unknown[][] = [];
  for (let start = 0; ; start += PAGE) {
    const filters = name === "jurnal" ? { start_date: "", end_date: "", akun: "" } : {};
    const page = JSON.parse(await request(path, { draw: "1", start: String(start), length: String(PAGE), ...filters }));
    rows.push(...page.data);
    process.stdout.write(`\r${name} ${rows.length}/${page.recordsFiltered}`);
    if (page.data.length < PAGE) break;
    await sleep(300);
  }
  writeFileSync(`${OUT}lists/${name}.json`, JSON.stringify(rows));
  console.log();
}
