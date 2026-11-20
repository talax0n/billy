import { BASIS_POINTS, type Discount, entryKey, type PosMethod, posMethods, type Rupiah, rupiahOrNull } from "@billy/core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Dialog } from "../components/ui/dialog.tsx";
import { Field, Input, MoneyInput, SearchInput, Select } from "../components/ui/field.tsx";
import { Loading } from "../components/ui/page.tsx";
import { toast } from "../components/ui/toast.tsx";
import { api, unwrap } from "../lib/api.ts";
import { cx } from "../lib/cx.ts";
import { desktop } from "../lib/desktop.ts";
import type { Catalog, OutboxItem, ParkedCart, SyncProblem } from "./local.ts";
import { dismissProblem, retryProblem } from "./outbox.ts";
import { accountFor, type PosPreferences } from "./preferences.ts";
import { countedReprint, methodLabels, type ReceiptData } from "./receipt.tsx";
import { productLabel } from "./search.tsx";
import { VoidSaleDialog } from "./void-sale.tsx";
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

/** Which account each method pays into, and on desktop the receipt printer. Stored on this device only. */
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

const problemLabel = (p: SyncProblem) => ({ title: p.sale.number, detail: `Rp ${money(p.receipt.total)}`, lost: "Transaksi ini" });

/** Entries the server refused, with its reason. Nothing leaves this list without a person deciding. */
export function ProblemsDialog({ problems, onClose }: { problems: SyncProblem[]; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title="Masalah sinkron" description="Server menolak transaksi ini. Perbaiki penyebabnya, lalu coba lagi.">
      {problems.length === 0 ? (
        <p className="text-muted">Tidak ada masalah.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {problems.map((p) => {
            const key = entryKey(p);
            const label = problemLabel(p);
            return (
              <li key={key} className="rounded-lg border border-line px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <b className="font-medium">{label.title}</b>
                  <span className="tabular-nums">{label.detail}</span>
                </div>
                <p className="mt-0.5 text-down">{p.error}</p>
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      if (window.confirm(`Hapus ${label.title} dari antrean? ${label.lost} tidak akan tercatat di server.`)) {
                        void dismissProblem(key);
                      }
                    }}
                  >
                    Hapus
                  </Button>
                  <Button size="sm" onClick={() => void retryProblem(key)}>
                    Coba lagi
                  </Button>
                </div>
              </li>
            );
          })}
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
  onRevise,
  onClose,
}: {
  pending: OutboxItem[];
  onReprint: (receipt: ReceiptData) => void;
  /** Starts a revisi of a sale the server holds; online only. */
  onRevise: (saleId: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // autoFocus loses to showModal(), which runs after this dialog's children mount.
  useEffect(() => void requestAnimationFrame(() => searchRef.current?.focus()), []);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);
  const sales = useQuery({
    queryKey: ["pos", "sales", "mine", search],
    queryFn: () => unwrap(api.pos.sales.$get({ query: { q: search, pageSize: "30" } })),
    placeholderData: keepPreviousData,
    networkMode: "always",
  });
  const typedTotal = rupiahOrNull(search);
  const queued = pending
    .flatMap((item) => ("sale" in item ? [item] : []))
    .filter((item) => item.sale.number.toLowerCase().includes(search.toLowerCase()) || item.receipt.total === typedTotal)
    .reverse();
  const [voiding, setVoiding] = useState<{ id: string; number: string } | null>(null);
  const reprint = async (id: string) => {
    try {
      onReprint(await countedReprint(id));
    } catch (err) {
      toast((err as Error).message, "down");
    }
  };
  const row = "grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-line-2 py-2 last:border-b-0";
  if (voiding) return <VoidSaleDialog sale={voiding} onClose={() => setVoiding(null)} />;
  return (
    <Dialog open onClose={onClose} title="Riwayat kasir" className="max-w-xl">
      <SearchInput
        className="mb-2 max-w-none"
        placeholder="Cari nomor struk atau total…"
        aria-label="Cari riwayat kasir"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        ref={searchRef}
      />
      <div className="flex flex-col">
        {queued.map((q) => (
          <div key={q.sale.id} className={row}>
            <span>
              {q.sale.number}
              <small className="block text-muted">{stamp.format(new Date(q.sale.soldAt))}</small>
            </span>
            <span className="flex items-center gap-2 tabular-nums">
              <Badge tone="warn">Menunggu sinkron</Badge>
              {money(q.receipt.total)}
            </span>
            <Button size="sm" onClick={() => onReprint({ ...q.receipt, copy: true })}>
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
                {s.revisionOfNumber && ` · revisi dari ${s.revisionOfNumber}`}
              </small>
            </span>
            <span className="flex items-center gap-2 tabular-nums">
              {s.revisedByNumber ? <Badge>Direvisi</Badge> : s.voidedAt && <Badge>Dibatalkan</Badge>}
              {money(s.total)}
            </span>
            <span className="flex gap-1.5">
              <Button size="sm" onClick={() => void reprint(s.id)}>
                Cetak ulang
              </Button>
              {!s.voidedAt && (
                <>
                  <Button size="sm" onClick={() => onRevise(s.id)} aria-label={`Revisi ${s.number}`}>
                    Revisi
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setVoiding(s)} aria-label={`Batalkan ${s.number}`}>
                    Batalkan
                  </Button>
                </>
              )}
            </span>
          </div>
        ))}
        {sales.isPending && <Loading className="py-6" />}
        {sales.isError && <p className="py-6 text-center text-muted">Riwayat server tidak bisa dimuat saat offline.</p>}
        {sales.data?.rows.length === 0 && queued.length === 0 && (
          <p className="py-6 text-center text-muted">{search ? `Tidak ada struk untuk "${search}".` : "Belum ada transaksi."}</p>
        )}
      </div>
    </Dialog>
  );
}

/**
 * F3: the customer on this receipt, searched from the customers cached with the catalog so it
 * works offline. The first row is always "Umum", the walk-in default.
 */
