/**
 * Fetches legacy detail pages and keeps only what the importer needs: the form inputs (name → value)
 * and every table row as an array of cell texts. Appends one JSON object per page to
 * .legacy/details/<kind>.jsonl, newest documents first, and skips ids already saved, so a rerun resumes.
 * Read-only: GET requests only.
 *
 *   LEGACY_JAR=<cookie jar> node tools/legacy/dump-details.ts <kind> [concurrency]
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { OUT, request, sleep } from "./session.ts";

type Row = string[];
interface Kind {
  list: string;
  /** Pages to fetch for one list row; the key names the page in the saved record. */
  pages: (row: Row) => Record<string, string>;
}

const id = (row: Row) => row.at(-1)!.match(/data-id="([^"]+)"|\/detail\/([^"\/]+)"/)?.slice(1).find(Boolean) ?? row.at(-1)!;
const money = (s: string) => Number(s.replace(/<[^>]+>/g, "").replace(/[^\d,-]/g, "").split(",")[0]);

const kinds: Record<string, Kind> = {
  penjualan: {
    list: "penjualan",
    pages: (row) => ({
      detail: `transaksi/penjualan/detail/${id(row)}`,
      // Only invoices with money received have payment rows worth fetching.
      ...(money(row[4]!) !== money(row[5]!) && { history: `transaksi/penjualan/history_transaksi/${id(row)}` }),
    }),
  },
  pembelian: {
    list: "pembelian",
    pages: (row) => ({
      detail: `transaksi/pembelian/detail/${id(row)}`,
      ...(money(row[8]!) > 0 && { history: `transaksi/pembelian/history_transaksi/${id(row)}` }),
    }),
  },
  kasir: { list: "kasir", pages: (row) => ({ receipt: `kasir/form/detail/${id(row)}` }) },
  tukar_faktur: { list: "tukar_faktur", pages: (row) => ({ detail: `transaksi/tukar_faktur/detail/${id(row)}` }) },
};

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** Inputs and table rows of the page body; the receipt page has no layout, so it is kept whole. */
function extract(html: string) {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<head[\s\S]*?<\/head>/g, "");
  const inputs: Record<string, string> = {};
  for (const [tag] of body.matchAll(/<input[^>]*>/g)) {
    const name = tag.match(/name="([^"]+)"/)?.[1] ?? tag.match(/placeholder="([^"]+)"/)?.[1];
    const value = tag.match(/value="([^"]*)"/)?.[1];
    if (name && value !== undefined) inputs[name] = value;
  }
  const rows = [...body.matchAll(/<tr[\s\S]*?<\/tr>/g)]
    .map(([tr]) => [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(([, cell]) => text(cell!)))
    .filter((cells) => cells.length > 0);
  return { inputs, rows, text: rows.length ? undefined : text(body).slice(0, 4000) };
}

const [kindName, concurrencyArg] = process.argv.slice(2);
const kind = kinds[kindName ?? ""];
if (!kind) throw new Error(`Usage: dump-details.ts <${Object.keys(kinds).join("|")}> [concurrency]`);

mkdirSync(`${OUT}details`, { recursive: true });
const file = `${OUT}details/${kindName}.jsonl`;
const done = new Set(
  existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line) => {
          // A run stopped mid-write can leave a partial last line; that page is fetched again.
          try {
            return [JSON.parse(line).id as string];
          } catch {
            return [];
          }
        })
    : [],
);
// List endpoints return newest first, which is the order to fetch in.
const rows = (JSON.parse(readFileSync(`${OUT}lists/${kind.list}.json`, "utf8")) as Row[]).filter((row) => !done.has(id(row)));

let next = 0;
let saved = 0;
async function worker() {
  while (next < rows.length) {
    const row = rows[next++]!;
    const pages: Record<string, ReturnType<typeof extract>> = {};
    for (const [key, path] of Object.entries(kind!.pages(row))) {
      pages[key] = extract(await request(path));
      await sleep(150);
    }
    appendFileSync(file, `${JSON.stringify({ id: id(row), row, pages })}\n`);
    if (++saved % 100 === 0) console.log(`${kindName} ${done.size + saved}/${done.size + rows.length}`);
  }
}
await Promise.all(Array.from({ length: Number(concurrencyArg ?? 3) }, worker));
console.log(`${kindName} done: ${done.size + saved}`);
