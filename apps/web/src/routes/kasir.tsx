import { cartTotals, emptyCartTotals, type PosMethod, type PosSaleInput, rupiah, type Rupiah, uuidv7 } from "@billy/core";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Contrast, LayoutDashboard, LogOut, Settings2 } from "lucide-react";
import { type KeyboardEvent, useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import { EmptyState } from "../components/ui/page.tsx";
import { toast } from "../components/ui/toast.tsx";
import { meQuery, useLogout } from "../lib/auth.ts";
import { cx } from "../lib/cx.ts";
import { setTheme } from "../lib/theme.ts";
import { cartReducer, emptyCart } from "../pos/cart.ts";
import { CartTable } from "../pos/cart-table.tsx";
import {
  HistoryDialog,
  LineDiscountDialog,
  NoteDialog,
  ParkedDialog,
  PreferencesDialog,
  ProblemsDialog,
  TxDiscountDialog,
} from "../pos/dialogs.tsx";
import { allocateNumber, type Catalog, catalogQuery, change, type ParkedCart, peekNumber, read, write } from "../pos/local.ts";
import { onFlushed, type OutboxSnapshot, queueSale, startOutbox, useOutbox } from "../pos/outbox.ts";
import { PayPanel } from "../pos/pay-panel.tsx";
import { accountFor, usePosPreferences } from "../pos/preferences.ts";
import { printReceipt, type ReceiptData, ReceiptPrinter } from "../pos/receipt.tsx";
import { exactMatch, SearchBox, searchProducts } from "../pos/search.tsx";
import { cacheAppShell } from "../pos/shell.ts";
import { Chip, Kbd } from "../pos/ui.tsx";

type DialogName = "lineDiscount" | "note" | "txDiscount" | "parked" | "history" | "problems" | "prefs";

/** Full-screen cashier. Works from the device cache, so it keeps selling while offline. */
export function KasirPage() {
  const queryClient = useQueryClient();
  const catalog = useQuery(catalogQuery);

  useEffect(() => {
    const stop = startOutbox();
    // Fresh stock and the server's last receipt number once queued sales have landed.
    const unsubscribe = onFlushed(() => void queryClient.invalidateQueries({ queryKey: catalogQuery.queryKey }));
    void cacheAppShell();
    return () => {
      stop();
      unsubscribe();
    };
  }, [queryClient]);

  if (catalog.isPending) return <p className="grid min-h-dvh place-items-center text-muted">Memuat katalog…</p>;
  if (catalog.isError) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <EmptyState title="Katalog belum tersimpan di perangkat ini" description="Sambungkan ke internet sekali untuk mengunduh produk dan akun." />
      </div>
    );
  }
  return (
    <>
      <Register catalog={catalog.data} />
      <ReceiptPrinter />
    </>
  );
}

function Register({ catalog }: { catalog: Catalog }) {
  const { data: me } = useSuspenseQuery(meQuery);
  const outbox = useOutbox();
  const [prefs, savePrefs] = usePosPreferences();
  const [cart, dispatch] = useReducer(cartReducer, emptyCart);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  /** ↑/↓ on an empty search moves to the cart: D and N then act on the row instead of typing. */
  const [rowMode, setRowMode] = useState(false);
  const [qtyEdit, setQtyEdit] = useState<number | null>(null);
  const [method, setMethod] = useState<PosMethod>("cash");
  const [tendered, setTendered] = useState<Rupiah>(rupiah(0));
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [parked, setParked] = useState<ParkedCart[]>([]);
  const [nextNumber, setNextNumber] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const tenderRef = useRef<HTMLInputElement>(null);

  const { shop } = catalog;
  const results = searchProducts(catalog.products, query);
  const computed = cartTotals(cart.lines, cart.discount);
  const totals = computed.ok ? computed.totals : emptyCartTotals;
  const account = accountFor(method, prefs, catalog.accounts);
  const short = method === "cash" && tendered > 0 && tendered < totals.total;
  const canPay = cart.lines.length > 0 && computed.ok && !short && account !== undefined;
  const line = cart.lines[cart.selected];

  useEffect(() => {
    void read("parked").then((list) => setParked(list ?? []));
  }, []);
  useEffect(() => {
    void peekNumber(shop.deviceCode, catalog.lastNumber).then(setNextNumber);
  }, [shop.deviceCode, catalog.lastNumber, outbox.pending.length]);

  const focusSearch = () => {
    setDialog(null);
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  const reset = () => {
    dispatch({ type: "load", cart: emptyCart });
    setTendered(rupiah(0));
    setMethod("cash");
    setQuery("");
    setRowMode(false);
  };

  const add = (productIndex: number, thenQty: boolean) => {
    const product = exactMatch(catalog.products, query) ?? results[productIndex];
    if (!product) return;
    const existing = cart.lines.findIndex((l) => l.productId === product.id && !l.note);
    dispatch({ type: "add", product });
    setQuery("");
    setHighlight(0);
    setRowMode(false);
    if (thenQty) setQtyEdit(existing >= 0 ? existing : cart.lines.length);
  };

  async function pay() {
    if (!canPay || !account) return;
    const number = await allocateNumber(shop.deviceCode, catalog.lastNumber);
    const paid = method === "cash" && tendered > 0 ? tendered : totals.total;
    const soldAt = new Date().toISOString();
    const sale: PosSaleInput = {
      id: uuidv7(),
      number,
      soldAt,
      customerId: null,
      lines: cart.lines.map(({ productId, qty, unitPrice, discountAmount, note }) => ({ productId, qty, unitPrice, discountAmount, note })),
      discount: cart.discount,
      method,
      accountId: account.id,
      tendered: paid,
      total: totals.total,
    };
    const receipt: ReceiptData = {
      number,
      soldAt,
      cashierName: me?.name ?? "",
      method,
      accountName: account.name,
      lines: cart.lines.map((l, i) => ({ ...l, name: `${l.name} ${l.variant}`.trim(), lineTotal: totals.lineTotals[i]! })),
      gross: totals.gross,
      lineDiscount: totals.lineDiscount,
      discountAmount: totals.discountAmount,
      total: totals.total,
      tendered: paid,
      change: rupiah(paid - totals.total),
    };
    await queueSale({ sale, receipt });
    await write("lastReceipt", receipt);
    printReceipt(receipt, shop, prefs.paper);
    reset();
    focusSearch();
  }

  // State first, storage after: a quick second F8 must already see the emptied cart.
  function park() {
    if (cart.lines.length === 0) {
      if (parked.length > 0) setDialog("parked");
      return;
    }
    const entry: ParkedCart = { id: uuidv7(), parkedAt: new Date().toISOString(), cart };
    setParked((list) => [...list, entry]);
    reset();
    void change("parked", (list = []) => [...list, entry]);
  }

  function restore(entry: ParkedCart) {
    setParked((list) => list.filter((p) => p.id !== entry.id));
    dispatch({ type: "load", cart: entry.cart });
    focusSearch();
    void change("parked", (list = []) => list.filter((p) => p.id !== entry.id));
  }

  const reprint = (receipt: ReceiptData) => printReceipt(receipt, shop, prefs.paper);

  async function reprintLast() {
    const last = await read("lastReceipt");
    if (last) reprint(last);
    else toast("Belum ada struk untuk dicetak ulang");
  }

  const onGlobalKey = useEffectEvent((e: globalThis.KeyboardEvent) => {
    if (dialog) return;
    if (e.key === "F2") focusSearch();
    else if (e.key === "F4") setDialog("txDiscount");
    else if (e.key === "F5") {
      setMethod("cash");
      requestAnimationFrame(() => tenderRef.current?.focus());
    } else if (e.key === "F6") setMethod("qris");
    else if (e.key === "F7") setMethod("transfer");
    else if (e.key === "F8") park();
    else if (e.key === "F9") setDialog("history");
    else if (e.key === "F10") void reprintLast();
    else if (e.key === "Delete" && e.ctrlKey) {
      if (cart.lines.length && window.confirm("Batalkan transaksi ini?")) reset();
      focusSearch();
    } else return;
    e.preventDefault();
  });

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => onGlobalKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    const searching = query.trim() !== "";
    const rowKeys: Record<string, () => void> = {
      "+": () => line && dispatch({ type: "qty", index: cart.selected, qty: line.qty + 1 }),
      "-": () => line && dispatch({ type: "qty", index: cart.selected, qty: line.qty - 1 }),
      Delete: () => line && dispatch({ type: "remove", index: cart.selected }),
    };
    if (rowMode) {
      rowKeys.d = rowKeys.D = () => line && setDialog("lineDiscount");
      rowKeys.n = rowKeys.N = () => line && setDialog("note");
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const step = e.key === "ArrowDown" ? 1 : -1;
      if (searching) setHighlight((h) => (h + step + results.length) % Math.max(results.length, 1));
      else if (cart.lines.length) {
        dispatch({ type: "select", index: cart.selected + step });
        setRowMode(true);
      }
    } else if (e.key === "Enter") {
      if (searching) add(highlight, e.shiftKey);
      else void pay();
    } else if (e.key === "Escape") {
      setQuery("");
      setRowMode(false);
    } else if (!searching && !e.ctrlKey && rowKeys[e.key]) {
      rowKeys[e.key]!();
    } else {
      if (e.key.length === 1) setRowMode(false);
      return;
    }
    e.preventDefault();
  }

  return (
    <div className="flex h-dvh min-h-[600px] flex-col">
      <TopBar
        catalog={catalog}
        nextNumber={nextNumber}
        cashierName={me?.name ?? ""}
        outbox={outbox}
        backOffice={me?.role !== "kasir"}
        onProblems={() => setDialog("problems")}
        onPrefs={() => setDialog("prefs")}
      />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px] gap-2.5 px-2.5 pb-2.5">
        <section className="flex min-h-0 flex-col rounded-[14px] border border-line bg-panel">
          <SearchBox
            inputRef={searchRef}
            query={query}
            results={results}
            highlight={highlight}
            onQuery={(q) => {
              setQuery(q);
              setHighlight(0);
            }}
            onKeyDown={onSearchKey}
            onPick={(p) => {
              dispatch({ type: "add", product: p });
              setQuery("");
            }}
            onBlur={() =>
              // Always focused: give focus back unless it moved to another control on purpose.
              setTimeout(() => {
                if (document.activeElement === document.body) searchRef.current?.focus();
              })
            }
          />
          <CartTable
            cart={cart}
            lineTotals={computed.ok ? totals.lineTotals : []}
            dispatch={dispatch}
            qtyEdit={qtyEdit}
            onQtyEditDone={() => {
              setQtyEdit(null);
              focusSearch();
            }}
          />
        </section>
        <aside className="flex min-h-0 flex-col overflow-y-auto rounded-[14px] border border-line bg-panel">
          <PayPanel
            totals={totals}
            error={computed.ok ? null : computed.error}
            discount={cart.discount}
            method={method}
            accountName={account?.name ?? "—"}
            tendered={tendered}
            tenderRef={tenderRef}
            canPay={canPay}
            onMethod={setMethod}
            onTendered={setTendered}
            onTenderKey={(key) => (key === "Enter" ? void pay() : focusSearch())}
            onTxDiscount={() => setDialog("txDiscount")}
            onChooseAccount={() => setDialog("prefs")}
            onPay={() => void pay()}
          />
        </aside>
      </div>
      <div className="flex gap-4 px-4 pb-2.5 text-xs text-muted">
        {(
          [
            ["F2", "cari"],
            ["F4", "diskon"],
            ["F8", parked.length ? `tahan transaksi (${parked.length} ditahan)` : "tahan transaksi"],
            ["F9", "riwayat"],
            ["F10", "cetak ulang"],
          ] as const
        ).map(([key, label]) => (
          <span key={key} className="flex items-center gap-1.5">
            <Kbd>{key}</Kbd> {label}
          </span>
        ))}
        <span className="flex-1" />
        <span className="flex items-center gap-1.5">
          <Kbd>Ctrl</Kbd>+<Kbd>Del</Kbd> batalkan
        </span>
      </div>

      {dialog === "lineDiscount" && line && (
        <LineDiscountDialog
          line={line}
          onClose={focusSearch}
          onSave={(amount) => {
            dispatch({ type: "discount", index: cart.selected, amount });
            focusSearch();
          }}
        />
      )}
      {dialog === "note" && line && (
        <NoteDialog
          line={line}
          onClose={focusSearch}
          onSave={(note) => {
            dispatch({ type: "note", index: cart.selected, note });
            focusSearch();
          }}
        />
      )}
      {dialog === "txDiscount" && (
        <TxDiscountDialog
          discount={cart.discount}
          onClose={focusSearch}
          onSave={(discount) => {
            dispatch({ type: "txDiscount", discount });
            focusSearch();
          }}
        />
      )}
      {dialog === "parked" && <ParkedDialog parked={parked} onRestore={restore} onClose={focusSearch} />}
      {dialog === "history" && <HistoryDialog pending={outbox.pending} onReprint={reprint} onClose={focusSearch} />}
      {dialog === "problems" && <ProblemsDialog problems={outbox.problems} onClose={focusSearch} />}
      {dialog === "prefs" && (
        <PreferencesDialog
          prefs={prefs}
          accounts={catalog.accounts}
          onClose={focusSearch}
          onSave={(next) => {
            savePrefs(next);
            focusSearch();
          }}
        />
      )}
    </div>
  );
}

function TopBar({
  catalog,
  nextNumber,
  cashierName,
  outbox,
  backOffice,
  onProblems,
  onPrefs,
}: {
  catalog: Catalog;
  nextNumber: string;
  cashierName: string;
  outbox: OutboxSnapshot;
  backOffice: boolean;
  onProblems: () => void;
  onPrefs: () => void;
}) {
  const logout = useLogout();
  const initials = catalog.shop.shopName
    .replace(/^toko\s+/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  const toggleTheme = () => {
    const dark =
      document.documentElement.dataset.theme === "dark" ||
      (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    setTheme(dark ? "light" : "dark");
  };

  return (
    <header className="flex items-center gap-3.5 px-4 py-2.5">
      <div className="grid size-[26px] place-items-center rounded-[7px] bg-ink text-xs font-semibold text-panel">{initials || "B"}</div>
      <b className="text-[15px] font-semibold">Kasir</b>
      <Chip>
        No. <strong className="font-medium text-ink tabular-nums">{nextNumber}</strong>
      </Chip>
      <Chip>
        Pelanggan <strong className="font-medium text-ink">Umum</strong>
      </Chip>
      <span className="flex-1" />
      <SyncChip outbox={outbox} />
      {outbox.problems.length > 0 && (
        <Chip onClick={onProblems} className="border-transparent bg-down/10 text-down">
          <span className="size-[7px] rounded-full bg-current" />
          <strong className="font-medium">{outbox.problems.length} masalah sinkron</strong>
        </Chip>
      )}
      <Chip>
        Kasir <strong className="font-medium text-ink">{cashierName}</strong> · {catalog.shop.deviceCode}
      </Chip>
      <Chip onClick={onPrefs} title="Pengaturan kasir" className="px-2">
        <Settings2 className="size-3.5" />
      </Chip>
      <Chip onClick={toggleTheme} title="Ganti tema" className="px-2">
        <Contrast className="size-3.5" />
      </Chip>
      {backOffice && (
        <Link to="/" title="Kembali ke dasbor" className="flex items-center gap-1.5 rounded-full border border-line bg-panel px-2 py-1 text-muted hover:text-ink">
          <LayoutDashboard className="size-3.5" />
        </Link>
      )}
      <Chip onClick={logout} title="Keluar" className="px-2">
        <LogOut className="size-3.5" />
      </Chip>
    </header>
  );
}

/** Online, offline with the queue size, or uploading. Server unreachable counts as offline for the cashier. */
function SyncChip({ outbox }: { outbox: OutboxSnapshot }) {
  const pending = outbox.pending.length;
  const { phase } = outbox.sync;
  const offline = phase === "offline" || phase === "backoff";
  const waiting = pending ? ` · ${pending} transaksi menunggu sinkron` : "";
  return (
    <Chip className={cx(offline && "border-transparent bg-warn-bg text-warn")} title={outbox.sync.lastSyncedAt ? `Terakhir sinkron ${new Date(outbox.sync.lastSyncedAt).toLocaleTimeString("id-ID")}` : undefined}>
      <span className={cx("size-[7px] rounded-full", offline ? "bg-current" : "bg-up")} />
      <strong className={cx("font-medium", offline ? "text-warn" : "text-ink")} data-testid="sync-state">
        {offline ? "Offline" : phase === "syncing" && pending ? "Menyinkronkan" : "Online"}
      </strong>
      <span data-testid="sync-pending">{waiting}</span>
    </Chip>
  );
}
