import { BASIS_POINTS, type Discount, type PosMethod, posMethods, type Rupiah } from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useState } from "react";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Dialog } from "../components/ui/dialog.tsx";
import { Field, Input, MoneyInput, Select } from "../components/ui/field.tsx";
import { toast } from "../components/ui/toast.tsx";
import { api, unwrap } from "../lib/api.ts";
import { cx } from "../lib/cx.ts";
import { desktop } from "../lib/desktop.ts";
import type { CartLine } from "./cart.ts";
import type { Catalog, CatalogCustomer, ParkedCart, QueuedSale, SyncProblem } from "./local.ts";
import { dismissProblem, retryProblem } from "./outbox.ts";
import { accountFor, type PosPreferences } from "./preferences.ts";
import { methodLabels, type ReceiptData, receiptFromSale } from "./receipt.tsx";
import { productLabel } from "./search.tsx";
import { money } from "./ui.tsx";

function DialogForm({ onSubmit, children, submitLabel }: { onSubmit: () => void; children: ReactNode; submitLabel: string }) {
  return (
    <form
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-4"
    >
      {children}
      <div className="flex justify-end">
        <Button type="submit" variant="primary">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function LineDiscountDialog({ line, onSave, onClose }: { line: CartLine; onSave: (amount: Rupiah) => void; onClose: () => void }) {
  const [amount, setAmount] = useState(line.discountAmount);
  const gross = line.qty * line.unitPrice;
  const error = amount > gross ? `Maksimal ${money(gross)}` : undefined;
  return (
    <Dialog open onClose={onClose} title="Diskon baris" description={`${productLabel(line)} · ${line.qty} × ${money(line.unitPrice)}`}>
      <DialogForm submitLabel="Simpan diskon" onSubmit={() => !error && onSave(amount)}>
        <Field label="Potongan untuk baris ini" error={error}>
          {(p) => <MoneyInput {...p} autoFocus value={amount} onChange={setAmount} onFocus={(e) => e.target.select()} />}
        </Field>
      </DialogForm>
    </Dialog>
  );
}

export function NoteDialog({ line, onSave, onClose }: { line: CartLine; onSave: (note: string) => void; onClose: () => void }) {
  const [note, setNote] = useState(line.note);
  return (
    <Dialog open onClose={onClose} title="Catatan baris" description={productLabel(line)}>
      <DialogForm submitLabel="Simpan catatan" onSubmit={() => onSave(note)}>
        <Field label="Kode warna tinting" hint="Tercetak di struk dengan “Cat tinting tidak bisa diretur”.">
          {(p) => <Input {...p} autoFocus maxLength={200} placeholder="Kode warna: RAL 7035" value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </DialogForm>
    </Dialog>
  );
}

/** Percent is typed as a number like `12,5` and stored in basis points; amount in whole rupiah. */
export function TxDiscountDialog({ discount, onSave, onClose }: { discount: Discount; onSave: (d: Discount) => void; onClose: () => void }) {
  const [kind, setKind] = useState<"percent" | "amount">(discount.kind === "amount" ? "amount" : "percent");
  const [percent, setPercent] = useState(discount.kind === "percent" ? String(discount.value / 100).replace(".", ",") : "");
  const [amount, setAmount] = useState((discount.kind === "amount" ? discount.value : 0) as Rupiah);
  const bp = Math.round(Number(percent.replace(",", ".") || 0) * 100);
  const save = () => {
    const value = kind === "percent" ? bp : amount;
    onSave(value > 0 ? { kind, value } : { kind: "none", value: 0 });
  };
  return (
    <Dialog open onClose={onClose} title="Diskon transaksi" description="Dipotong dari subtotal setelah diskon baris.">
      <DialogForm submitLabel="Simpan diskon" onSubmit={save}>
        <div role="radiogroup" aria-label="Jenis diskon" className="grid grid-cols-2 rounded-lg bg-line-2 p-0.5">
          {(["percent", "amount"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={cx("h-8 rounded-md text-muted", kind === k && "bg-panel font-medium text-ink")}
            >
              {k === "percent" ? "Persen" : "Rupiah"}
            </button>
          ))}
        </div>
        {kind === "percent" ? (
          <Field label="Diskon (%)" error={bp > BASIS_POINTS || Number.isNaN(bp) ? "Isi 0–100" : undefined}>
            {(p) => <Input {...p} autoFocus inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^\d,]/g, ""))} />}
          </Field>
        ) : (
          <Field label="Potongan">{(p) => <MoneyInput {...p} autoFocus value={amount} onChange={setAmount} />}</Field>
        )}
      </DialogForm>
    </Dialog>
  );
}

/** Which account each method pays into, the receipt paper, and on desktop the receipt printer. Stored on this device only. */
export function PreferencesDialog({
  prefs,
  accounts,
  onSave,
  onClose,
}: {
  prefs: PosPreferences;
  accounts: Catalog["accounts"];
  onSave: (prefs: PosPreferences) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<PosPreferences>(() => ({
    paper: prefs.paper,
    accounts: Object.fromEntries(posMethods.map((m) => [m, accountFor(m, prefs, accounts)?.id])),
  }));
  const printers = useQuery({
    queryKey: ["desktop-printers"],
    enabled: desktop !== undefined,
    gcTime: 0, // re-read on every open: the saved printer changes from this dialog
    queryFn: async () => ({ list: await desktop!.listPrinters(), saved: await desktop!.receiptPrinter() }),
  });
  const [printer, setPrinter] = useState<string>();
  function save() {
    if (desktop && printer !== undefined) void desktop.setReceiptPrinter(printer);
    onSave(draft);
  }
  return (
    <Dialog open onClose={onClose} title="Pengaturan kasir" description="Berlaku untuk perangkat ini saja.">
      <DialogForm submitLabel="Simpan" onSubmit={save}>
        {posMethods.map((m: PosMethod) => (
          <Field key={m} label={`${methodLabels[m]} masuk ke`}>
            {(p) => (
              <Select
                {...p}
                value={draft.accounts[m] ?? ""}
                onChange={(e) => setDraft({ ...draft, accounts: { ...draft.accounts, [m]: e.target.value } })}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ))}
        <Field label="Lebar kertas struk">
          {(p) => (
            <Select {...p} value={draft.paper} onChange={(e) => setDraft({ ...draft, paper: Number(e.target.value) === 58 ? 58 : 80 })}>
              <option value={80}>80 mm</option>
              <option value={58}>58 mm</option>
            </Select>
          )}
        </Field>
        {desktop && (
          <Field label="Printer struk">
            {(p) => (
              <Select {...p} value={printer ?? printers.data?.saved ?? ""} onChange={(e) => setPrinter(e.target.value)}>
                <option value="">Printer bawaan sistem</option>
                {printers.data?.list.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.displayName}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </DialogForm>
    </Dialog>
  );
}

const time = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

export function ParkedDialog({
  parked,
  onRestore,
  onClose,
}: {
  parked: ParkedCart[];
  onRestore: (p: ParkedCart) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onClose={onClose} title="Transaksi ditahan" description="Pilih untuk melanjutkan.">
      <ul className="flex flex-col gap-1.5">
        {parked.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              autoFocus={i === 0}
              onClick={() => onRestore(p)}
              className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-2.5 text-left hover:bg-line-2 focus:border-ink focus:outline-none"
            >
              <span>
                {p.cart.lines.map((l) => productLabel(l)).join(", ")}
                <small className="block text-muted">
                  Ditahan {time.format(new Date(p.parkedAt))} · {p.cart.lines.length} produk
                </small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/** Sales the server refused, with its reason. Nothing leaves this list without a person deciding. */
export function ProblemsDialog({ problems, onClose }: { problems: SyncProblem[]; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title="Masalah sinkron" description="Server menolak transaksi ini. Perbaiki penyebabnya, lalu coba lagi.">
      {problems.length === 0 ? (
        <p className="text-muted">Tidak ada masalah.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {problems.map((p) => (
            <li key={p.sale.id} className="rounded-lg border border-line px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <b className="font-medium">{p.sale.number}</b>
                <span className="tabular-nums">Rp {money(p.receipt.total)}</span>
              </div>
              <p className="mt-0.5 text-down">{p.error}</p>
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    if (window.confirm(`Hapus ${p.sale.number} dari antrean? Transaksi ini tidak akan tercatat di server.`)) {
                      void dismissProblem(p.sale.id);
                    }
                  }}
                >
                  Hapus
                </Button>
                <Button size="sm" onClick={() => void retryProblem(p.sale.id)}>
                  Coba lagi
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

const stamp = new Intl.DateTimeFormat("id-ID", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jakarta" });

/** The cashier's own receipts: still queued on this device first, then what the server holds. */
export function HistoryDialog({
  pending,
  onReprint,
  onClose,
}: {
  pending: QueuedSale[];
  onReprint: (receipt: ReceiptData) => void;
  onClose: () => void;
}) {
  const sales = useQuery({
    queryKey: ["pos", "sales", "mine"],
    queryFn: () => unwrap(api.pos.sales.$get({ query: { pageSize: "30" } })),
    networkMode: "always",
  });
  const reprint = async (id: string) => {
    try {
      onReprint(receiptFromSale(await unwrap(api.pos.sales[":id"].$get({ param: { id } }))));
    } catch (err) {
      toast((err as Error).message, "down");
    }
  };
  const row = "grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-line-2 py-2 last:border-b-0";
  return (
    <Dialog open onClose={onClose} title="Riwayat kasir" className="max-w-xl">
      <div className="flex flex-col">
        {[...pending].reverse().map((q) => (
          <div key={q.sale.id} className={row}>
            <span>
              {q.sale.number}
              <small className="block text-muted">{stamp.format(new Date(q.sale.soldAt))}</small>
            </span>
            <span className="flex items-center gap-2 tabular-nums">
              <Badge tone="warn">Menunggu sinkron</Badge>
              {money(q.receipt.total)}
            </span>
            <Button size="sm" onClick={() => onReprint(q.receipt)}>
              Cetak ulang
            </Button>
          </div>
        ))}
        {sales.data?.rows.map((s) => (
          <div key={s.id} className={row}>
            <span>
              {s.number}
              <small className="block text-muted">
                {stamp.format(new Date(s.soldAt))} · {methodLabels[s.method]}
              </small>
            </span>
            <span className="flex items-center gap-2 tabular-nums">
              {s.voidedAt && <Badge>Void</Badge>}
              {money(s.total)}
            </span>
            <Button size="sm" onClick={() => void reprint(s.id)}>
              Cetak ulang
            </Button>
          </div>
        ))}
        {sales.isPending && <p className="py-6 text-center text-muted">Memuat…</p>}
        {sales.isError && <p className="py-6 text-center text-muted">Riwayat server tidak bisa dimuat saat offline.</p>}
        {sales.data?.rows.length === 0 && pending.length === 0 && <p className="py-6 text-center text-muted">Belum ada transaksi.</p>}
      </div>
    </Dialog>
  );
}

/**
 * F3: the customer on this receipt, searched from the customers cached with the catalog so it
 * works offline. The first row is always "Umum", the walk-in default.
 */
export function CustomerDialog({
  customers,
  onSave,
  onClose,
}: {
  customers: CatalogCustomer[];
  onSave: (customer: CatalogCustomer | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = customers.filter((c) => terms.every((t) => `${c.name} ${c.code}`.toLowerCase().includes(t))).slice(0, 8);
  const options: (CatalogCustomer | null)[] = [null, ...matches];
  return (
    <Dialog open onClose={onClose} title="Pelanggan" description="Kosongkan untuk pelanggan umum.">
      <div className="flex flex-col gap-3">
        <Input
          autoFocus
          aria-label="Cari pelanggan"
          placeholder="Cari nama atau kode pelanggan"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(e.target.value.trim() ? 1 : 0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setHighlight((h) => (h + step + options.length) % options.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              onSave(options[highlight] ?? null);
            }
          }}
        />
        <ul role="listbox" aria-label="Pelanggan" className="flex flex-col">
          {options.map((c, i) => (
            <li key={c?.id ?? "umum"} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onClick={() => onSave(c)}
                onMouseEnter={() => setHighlight(i)}
                className={cx("flex w-full justify-between rounded-lg px-3 py-2 text-left", i === highlight && "bg-line-2")}
              >
                <span>{c?.name ?? "Umum"}</span>
                <span className="text-muted">{c?.code ?? "tanpa nama"}</span>
              </button>
            </li>
          ))}
        </ul>
        {terms.length > 0 && matches.length === 0 && <p className="text-muted">Tidak ada pelanggan yang cocok.</p>}
      </div>
    </Dialog>
  );
}
