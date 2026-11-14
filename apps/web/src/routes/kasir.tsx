import {
  type ApprovalRequestInput,
  breachMessage,
  cartTotals,
  type DeliveryDetailsInput,
  emptyCartTotals,
  type PosMethod,
  type PosSaleInput,
  rupiah,
  type Rupiah,
  saleLimitBreaches,
  uploadOutcome,
  uuidv7,
} from "@billy/core";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Contrast, LayoutDashboard, LogOut, Settings2, Truck } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import { ApprovalDialog } from "../components/approval-dialog.tsx";
import { EmptyState } from "../components/ui/page.tsx";
import { toast } from "../components/ui/toast.tsx";
import { api, ApiError, unwrap } from "../lib/api.ts";
import { meQuery, useLogout } from "../lib/auth.ts";
import { cx } from "../lib/cx.ts";
import { setTheme } from "../lib/theme.ts";
import { cartReducer, emptyCart } from "../pos/cart.ts";
import { CartTable } from "../pos/cart-table.tsx";
import {
  CloseShiftDialog,
  CustomerDialog,
  HistoryDialog,
  LineDiscountDialog,
  NoteDialog,
  OpenShiftDialog,
  ParkedDialog,
  PreferencesDialog,
  ProblemsDialog,
  TxDiscountDialog,
} from "../pos/dialogs.tsx";
import {
  type Catalog,
  type CatalogCustomer,
  catalogQuery,
  change,
  commitNumber,
  deductSold,
  type LocalShift,
  type ParkedCart,
  peekNumber,
  type QueuedSale,
  read,
  saveShift,
  write,
} from "../pos/local.ts";
import { cartFromDraft, cartFromSale, type DraftDetail, DraftsDialog, openDraftsQuery, RevisiDialog } from "../pos/drafts.tsx";
import {
  flush,
  onFlushed,
  type OutboxSnapshot,
  queue,
  sendDraftPayment,
  sendRevision,
  sendSale,
  startOutbox,
  type UploadResult,
  useOutbox,
} from "../pos/outbox.ts";
import { PayPanel } from "../pos/pay-panel.tsx";
import { accountFor, usePosPreferences } from "../pos/preferences.ts";
import { countedReprint, printReceipt, type ReceiptData, ReceiptPrinter } from "../pos/receipt.tsx";
import { exactMatch, SearchBox, searchProducts } from "../pos/search.tsx";
import { cacheAppShell } from "../pos/shell.ts";
import { Chip, Kbd } from "../pos/ui.tsx";

type DialogName = "customer" | "lineDiscount" | "note" | "txDiscount" | "parked" | "history" | "problems" | "prefs" | "closeShift" | "drafts" | "revisi";

type SaleDetail = Awaited<ReturnType<typeof fetchSale>>;
const fetchSale = (id: string) => unwrap(api.pos.sales[":id"].$get({ param: { id } }));

/** Where a sale goes and how it is retried with an approval. */
interface SaleTarget {
  request: ApprovalRequestInput;
  send: (approval?: NonNullable<PosSaleInput["approval"]>) => Promise<UploadResult>;
}

/** Full-screen cashier. Works from the device cache, so it keeps selling while offline. */
export function KasirPage() {
  const queryClient = useQueryClient();
  const catalog = useQuery(catalogQuery);
  const { data: me } = useSuspenseQuery(meQuery);
  const userId = me?.id;
  const role = me?.role;

  useEffect(() => {
    if (!userId || !role) return;
    const stop = startOutbox({ id: userId, role });
    // Fresh stock and the server's last receipt number once queued sales have landed.
    const unsubscribe = onFlushed(() => void queryClient.invalidateQueries({ queryKey: catalogQuery.queryKey }));
    void cacheAppShell();
    return () => {
      stop();
      unsubscribe();
    };
  }, [queryClient, userId, role]);

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
  const queryClient = useQueryClient();
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
  /** A sale the server refused until an admin approves it; `offline` when approval cannot be reached. */
  const [blocked, setBlocked] = useState<({ item: QueuedSale; message: string; offline: boolean } & SaleTarget) | null>(null);
  /** The nota sementara loaded in the cart: paying it pays that draft. */
  const [activeDraft, setActiveDraft] = useState<{ id: string; number: string } | null>(null);
  /** A revisi in progress: the cart holds the new lines of `original`. */
  const [revising, setRevising] = useState<{ original: { id: string; number: string; total: Rupiah }; reason: string } | null>(null);
  const [revisiOf, setRevisiOf] = useState<SaleDetail | null>(null);
  /** "Diantar ke alamat" for this sale; null while off. */
  const [delivery, setDelivery] = useState<Required<DeliveryDetailsInput> | null>(null);
  const drafts = useQuery(openDraftsQuery);
  /** This cashier's open shift on the device; `undefined` while it loads, `null` when none is open. */
  const [shift, setShift] = useState<LocalShift | null | undefined>(undefined);
  const logout = useLogout();
  const paying = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const tenderRef = useRef<HTMLInputElement>(null);

  const { shop } = catalog;
  /** Fills the delivery from the customer's contact card; a catalog cached by an older app version has no address. */
  const withCustomer = (details: Required<DeliveryDetailsInput>, c: CatalogCustomer | null | undefined) =>
    c ? { ...details, customerName: c.name, address: c.address ?? "", phone: c.phone ?? "" } : details;
  const results = searchProducts(catalog.products, query);
  const computed = cartTotals(cart.lines, cart.discount);
  const totals = computed.ok ? computed.totals : emptyCartTotals;
  const account = accountFor(method, prefs, catalog.accounts);
  const due = rupiah(Math.max(totals.total - (revising?.original.total ?? 0), 0));
  const short = method === "cash" && tendered > 0 && tendered < due;
  const drawer = accountFor("cash", prefs, catalog.accounts);
  const canPay = cart.lines.length > 0 && computed.ok && !short && account !== undefined && Boolean(shift) && (!delivery || delivery.address.trim() !== "");
  const line = cart.lines[cart.selected];

  useEffect(() => {
    void read("parked").then((list) => setParked(list ?? []));
  }, []);
  // The device's own record first. Without one, the server's open shift for this cashier here,
  // e.g. after the browser storage was cleared, unless its close is still waiting in the outbox.
  const meId = me?.id;
  useEffect(() => {
    if (!meId) return;
    let live = true;
    void (async () => {
      let mine: LocalShift | null = (await read("shifts"))?.[meId] ?? null;
      if (!mine) {
        const query = { query: { deviceCode: shop.deviceCode } };
        const server = await unwrap(api.pos.shifts.current.$get(query, { init: { signal: AbortSignal.timeout(5_000) } })).catch(() => null);
        const closing = (await read("outbox"))?.some((e) => "shift" in e && e.shift.event === "close" && e.shift.id === server?.shift?.id);
        if (server?.shift && !closing) {
          mine = server.shift;
          await saveShift(meId, mine);
        }
      }
      if (live) setShift(mine);
    })();
    return () => {
      live = false;
    };
  }, [meId, shop.deviceCode]);

  async function openShift(openingFloat: Rupiah) {
    if (!me || !drawer) return;
    const opened: LocalShift = { id: uuidv7(), deviceCode: shop.deviceCode, accountId: drawer.id, openedAt: new Date().toISOString(), openingFloat };
    await saveShift(me.id, opened);
    setShift(opened);
    await queue({ shift: { event: "open", cashierId: me.id, ...opened } });
    focusSearch();
  }

  async function closeShift(countedCash: Rupiah, note: string) {
    if (!me || !shift) return;
    await queue({ shift: { event: "close", id: shift.id, cashierId: me.id, closedAt: new Date().toISOString(), countedCash, note } });
    await saveShift(me.id, null);
    setShift(null);
    setDialog(null);
    toast("Shift ditutup", "up");
  }

  useEffect(() => {
    void peekNumber(shop.deviceCode, catalog.lastNumber).then(setNextNumber);
  }, [shop.deviceCode, catalog.lastNumber, outbox.pending.length]);

  const focusSearch = () => {
    setDialog(null);
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  const reset = () => {
    dispatch({ type: "load", cart: emptyCart });
    setActiveDraft(null);
    setRevising(null);
    setDelivery(null);
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

  /**
   * Online, the sale goes straight to the server so a limit is caught before the receipt prints.
   * Offline, or when the server cannot be reached, it is queued; a sale the device already knows
   * is over the discount cap is blocked instead, since approval needs the server.
   */
  async function pay() {
    if (!canPay || !account || !shift || paying.current) return;
    paying.current = true;
    try {
      // The shift's open must reach the server before a sale sent straight to it.
      if (outbox.pending.some((e) => "shift" in e && e.shift.id === shift.id)) await flush();
      const item = buildSale(account, shift.id, await peekNumber(shop.deviceCode, catalog.lastNumber));
      if (activeDraft || revising) return await payOnline(item);
      const limits = catalog.limits ?? { kasirMaxDiscountBp: 500, allowBelowCost: false };
      const breaches = me?.role === "admin" ? [] : saleLimitBreaches(cart.lines, cart.discount, limits);
      const offlineBlock = () => setBlocked({ item, message: breachMessage(breaches), offline: true, ...saleTarget(item) });
      // Backoff: the server was just unreachable; queue at once rather than wait for another timeout.
      if (outbox.sync.phase === "offline" || outbox.sync.phase === "backoff") {
        if (breaches.length) offlineBlock();
        else await complete(item, false);
        return;
      }
      const result = await sendSale(item.sale, 6_000);
      if (result.status >= 200 && result.status < 300) await complete(item, true);
      else if (result.needsApproval) setBlocked({ item, message: result.error, offline: false, ...saleTarget(item) });
      else if (uploadOutcome(result.status) !== "retry") toast(result.error, "down");
      else if (breaches.length) offlineBlock();
      else await complete(item, false);
    } finally {
      paying.current = false;
    }
  }

  const saleTarget = (item: QueuedSale): SaleTarget => ({
    request: { action: "pos.sale", sale: item.sale },
    send: (approval) => sendSale({ ...item.sale, ...(approval && { approval }) }),
  });

  /** Paying a nota sementara or saving a revisi needs the server; neither is ever queued. */
  async function payOnline(item: QueuedSale) {
    let target: SaleTarget;
    if (revising) {
      const { soldAt: _, cashierId: _c, ...sale } = item.sale;
      const revision = { ...sale, reason: revising.reason };
      const originalId = revising.original.id;
      target = {
        request: { action: "pos.revise", originalId, revision },
        send: (approval) => sendRevision(originalId, { ...revision, ...(approval && { approval }) }),
      };
    } else {
      const draftId = activeDraft!.id;
      target = { ...saleTarget(item), send: (approval) => sendDraftPayment(draftId, { ...item.sale, ...(approval && { approval }) }) };
    }
    const result = await target.send();
    if (result.status >= 200 && result.status < 300) await complete(item, true);
    else if (result.needsApproval) setBlocked({ item, message: result.error, offline: false, ...target });
    else toast(result.status === 0 ? `${revising ? "Revisi" : "Nota sementara"} hanya bisa disimpan saat online` : result.error, "down");
  }

  function buildSale(account: { id: string; name: string }, shiftId: string, number: string): QueuedSale {
    // A revisi collects or refunds only the difference; a refund is always cash from the drawer.
    const difference = totals.total - (revising?.original.total ?? 0);
    const saleMethod = difference < 0 ? "cash" : method;
    const paid = saleMethod === "cash" && tendered > 0 ? tendered : due;
    const soldAt = new Date().toISOString();
    const sale: PosSaleInput = {
      id: uuidv7(),
      number,
      soldAt,
      customerId: cart.customer?.id ?? null,
      lines: cart.lines.map(({ productId, qty, unitPrice, discountAmount, note }) => ({ productId, qty, unitPrice, discountAmount, note })),
      discount: cart.discount,
      method: saleMethod,
      accountId: saleMethod === method ? account.id : (drawer?.id ?? account.id),
      tendered: paid,
      total: totals.total,
      cashierId: me?.id,
      shiftId,
      ...(delivery && !revising && { delivery }),
    };
    const receipt: ReceiptData = {
      number,
      soldAt,
      cashierName: me?.name ?? "",
      method: saleMethod,
      accountName: saleMethod === method ? account.name : (drawer?.name ?? account.name),
      lines: cart.lines.map((l, i) => ({ ...l, name: `${l.name} ${l.variant}`.trim(), lineTotal: totals.lineTotals[i]! })),
      gross: totals.gross,
      lineDiscount: totals.lineDiscount,
      discountAmount: totals.discountAmount,
      total: totals.total,
      tendered: paid,
      change: rupiah(paid - difference),
      saleId: sale.id,
      revisionOf: revising?.original,
    };
    return { sale, receipt };
  }

  /** The sale happened: keep its number, queue it unless the server already holds it, print. */
  async function complete(item: QueuedSale, uploaded: boolean) {
    await commitNumber(item.sale.number);
    if (!uploaded) await queue(item);
    else setNextNumber(await peekNumber(shop.deviceCode, catalog.lastNumber));
    await deductSold(item.sale.lines, (fn) => queryClient.setQueryData(catalogQuery.queryKey, (c) => c && fn(c)));
    if (revising) void queryClient.invalidateQueries({ queryKey: catalogQuery.queryKey });
    if (activeDraft) void queryClient.invalidateQueries({ queryKey: openDraftsQuery.queryKey });
    await write("lastReceipt", item.receipt);
    printReceipt(item.receipt, shop, prefs.paper);
    setBlocked(null);
    reset();
    focusSearch();
  }

  /** Retries the blocked sale with the admin's approval. The PIN rides only on this request, never in the outbox. */
  async function payApproved(approval: NonNullable<PosSaleInput["approval"]>) {
    if (!blocked) return;
    const result = await blocked.send(approval);
    if (result.status >= 200 && result.status < 300) return complete(blocked.item, true);
    throw new ApiError(result.error, result.status);
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

  async function saveDraft() {
    const json = {
      customerId: cart.customer?.id ?? null,
      lines: cart.lines.map(({ productId, qty, unitPrice, discountAmount, note }) => ({ productId, qty, unitPrice, discountAmount, note })),
      discount: cart.discount,
    };
    const saved = activeDraft
      ? await unwrap(api.pos.drafts[":id"].$put({ param: { id: activeDraft.id }, json }))
      : await unwrap(api.pos.drafts.$post({ json }));
    await queryClient.invalidateQueries({ queryKey: openDraftsQuery.queryKey });
    toast(`Disimpan sebagai nota sementara ${saved.number}`, "up");
    reset();
    focusSearch();
  }

  function openDraft(draft: DraftDetail) {
    dispatch({ type: "load", cart: cartFromDraft(draft, catalog) });
    setActiveDraft({ id: draft.id, number: draft.number });
    focusSearch();
  }

  async function askRevisi(saleId: string) {
    if (cart.lines.length) return toast("Selesaikan atau tahan transaksi ini dulu", "down");
    try {
      setRevisiOf(await fetchSale(saleId));
      setDialog("revisi");
    } catch (err) {
      toast((err as Error).message, "down");
    }
  }

  function startRevisi(sale: SaleDetail, reason: string) {
    dispatch({ type: "load", cart: cartFromSale(sale, catalog) });
    setRevising({ original: { id: sale.id, number: sale.number, total: sale.total }, reason });
    setMethod(sale.method);
    focusSearch();
  }

  const reprint = (receipt: ReceiptData) => printReceipt(receipt, shop, prefs.paper);

  async function reprintLast() {
    const last = await read("lastReceipt");
    if (!last) return toast("Belum ada struk untuk dicetak ulang");
    // Counted on the server when it holds the sale; offline or still queued, printed as a copy uncounted.
    reprint(last.saleId ? await countedReprint(last.saleId).catch(() => ({ ...last, copy: true })) : { ...last, copy: true });
  }

  const onGlobalKey = useEffectEvent((e: globalThis.KeyboardEvent) => {
    if (dialog || blocked || !shift) return;
    if (e.key === "F2") focusSearch();
    else if (e.key === "F3") setDialog("customer");
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
    <div className="flex h-dvh min-h-[600px] flex-col max-md:h-auto max-md:min-h-dvh">
      <TopBar
        catalog={catalog}
        nextNumber={nextNumber}
        customerName={cart.customer?.name ?? "Umum"}
        onCustomer={() => setDialog("customer")}
        cashierName={me?.name ?? ""}
        outbox={outbox}
        backOffice={me?.role !== "kasir"}
        onProblems={() => setDialog("problems")}
        onPrefs={() => setDialog("prefs")}
        shift={shift ?? null}
        draftCount={drafts.data?.total ?? null}
        onDrafts={() => setDialog("drafts")}
        mode={
          revising ? (
            <Chip onClick={() => window.confirm(`Batalkan revisi ${revising.original.number}?`) && reset()} title="Batalkan revisi" className="border-transparent bg-warn-bg text-warn">
              Revisi <strong className="font-medium">{revising.original.number}</strong> · batal
            </Chip>
          ) : (
            activeDraft && (
              <Chip>
                Nota sementara <strong className="font-medium text-ink">{activeDraft.number}</strong>
              </Chip>
            )
          )
        }
        onCloseShift={() => {
          if (cart.lines.length) toast("Selesaikan atau tahan transaksi ini dulu", "down");
          else setDialog("closeShift");
        }}
      />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px] gap-2.5 px-2.5 pb-2.5 max-md:grid-cols-1">
        <section className="flex min-h-0 flex-col rounded-[14px] border border-line bg-panel max-md:min-h-[45dvh]">
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
              // Not on touch screens, where refocusing would keep reopening the on-screen keyboard.
              setTimeout(() => {
                if (document.activeElement === document.body && !matchMedia("(pointer: coarse)").matches) searchRef.current?.focus();
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
        <aside className="flex min-h-0 flex-col overflow-y-auto rounded-[14px] border border-line bg-panel max-md:overflow-visible">
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
            paidBefore={revising?.original.total}
            delivery={delivery}
            onDelivery={(next) => setDelivery(next && !delivery ? withCustomer(next, cart.customer) : next)}
          />
        </aside>
      </div>
      <div className="flex gap-4 px-4 pb-2.5 text-xs text-muted max-md:hidden">
        {(
          [
            ["F2", "cari"],
            ["F3", "pelanggan"],
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

      {dialog === "customer" && (
        <CustomerDialog
          // A catalog cached by an older version of the app has no customers yet.
          customers={catalog.customers ?? []}
          onClose={focusSearch}
          onSave={(customer) => {
            dispatch({ type: "customer", customer });
            if (delivery) setDelivery(withCustomer({ customerName: "", address: "", phone: "", note: delivery.note }, customer));
            focusSearch();
          }}
        />
      )}
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
      {blocked && (
        <ApprovalDialog
          message={blocked.message}
          offline={blocked.offline}
          request={blocked.request}
          submit={payApproved}
          onClose={() => {
            setBlocked(null);
            focusSearch();
          }}
        />
      )}
      {shift === null && <OpenShiftDialog drawer={drawer} deviceCode={shop.deviceCode} onOpen={(f) => void openShift(f)} onLogout={logout} />}
      {dialog === "closeShift" && (
        <CloseShiftDialog
          openDrafts={drafts.isError ? null : (drafts.data?.rows.filter((d) => d.createdBy === me?.id) ?? null)}
          onClose={focusSearch}
          onSave={(counted, note) => void closeShift(counted, note)}
        />
      )}
      {dialog === "drafts" && (
        <DraftsDialog
          cartHasLines={cart.lines.length > 0 && !revising}
          active={activeDraft}
          onSave={saveDraft}
          onOpen={openDraft}
          onPrint={reprint}
          onClose={focusSearch}
        />
      )}
      {dialog === "revisi" && revisiOf && (
        <RevisiDialog number={revisiOf.number} onStart={(reason) => startRevisi(revisiOf, reason)} onClose={focusSearch} />
      )}
      {dialog === "parked" && <ParkedDialog parked={parked} onRestore={restore} onClose={focusSearch} />}
      {dialog === "history" && <HistoryDialog pending={outbox.pending} onReprint={reprint} onRevise={(id) => void askRevisi(id)} onClose={focusSearch} />}
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
  customerName,
  onCustomer,
  cashierName,
  outbox,
  backOffice,
  onProblems,
  onPrefs,
  shift,
  draftCount,
  onDrafts,
  mode,
  onCloseShift,
}: {
  catalog: Catalog;
  nextNumber: string;
  customerName: string;
  onCustomer: () => void;
  cashierName: string;
  outbox: OutboxSnapshot;
  backOffice: boolean;
  onProblems: () => void;
  onPrefs: () => void;
  shift: LocalShift | null;
  /** Open nota sementara on the server; null offline. */
  draftCount: number | null;
  onDrafts: () => void;
  /** What the cart holds besides a new sale: a loaded nota sementara or a revisi. */
  mode: ReactNode;
  onCloseShift: () => void;
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
    <header className="flex flex-wrap items-center gap-3.5 px-4 py-2.5 max-md:gap-2 max-md:px-2.5">
      <div className="grid size-[26px] place-items-center rounded-[7px] bg-ink text-xs font-semibold text-panel">{initials || "B"}</div>
      <b className="text-[15px] font-semibold">Kasir</b>
      <Chip>
        No. <strong className="font-medium text-ink tabular-nums">{nextNumber}</strong>
      </Chip>
      <Chip onClick={onCustomer} title="Ganti pelanggan (F3)">
        Pelanggan <strong className="font-medium text-ink">{customerName}</strong>
      </Chip>
      <Chip onClick={onDrafts} title="Nota sementara">
        Nota sementara{draftCount !== null && <strong className="font-medium text-ink">{draftCount} terbuka</strong>}
      </Chip>
      <Link to="/kasir/antar" title="Antrian Antar" aria-label="Antrian Antar" className="flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-ink-2 hover:text-ink">
        <Truck className="size-3.5" />
        Antar
      </Link>
      {mode}
      <span className="flex-1" />
      <SyncChip outbox={outbox} />
      {outbox.problems.length > 0 && (
        <Chip onClick={onProblems} className="border-transparent bg-down/10 text-down">
          <span className="size-[7px] rounded-full bg-current" />
          <strong className="font-medium">{outbox.problems.length} masalah sinkron</strong>
        </Chip>
      )}
      <Chip className="max-md:hidden">
        Kasir <strong className="font-medium text-ink">{cashierName}</strong> · {catalog.shop.deviceCode}
      </Chip>
      {shift && (
        <Chip onClick={onCloseShift} title="Tutup shift">
          Shift sejak <strong className="font-medium text-ink tabular-nums">{shiftTime.format(new Date(shift.openedAt))}</strong>
        </Chip>
      )}
      <Chip onClick={onPrefs} title="Pengaturan kasir" className="px-2">
        <Settings2 className="size-3.5" />
      </Chip>
      <Chip onClick={toggleTheme} title="Ganti tema" className="px-2">
        <Contrast className="size-3.5" />
      </Chip>
      {backOffice && (
        <Link to="/" title="Pindah ke mode Kantor" className="flex items-center gap-1.5 rounded-full border border-line bg-panel px-2 py-1 text-muted hover:text-ink">
          <LayoutDashboard className="size-3.5" />
          Kantor
        </Link>
      )}
      <Chip onClick={logout} title="Keluar" className="px-2">
        <LogOut className="size-3.5" />
      </Chip>
    </header>
  );
}

const shiftTime = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

/** Online, offline with the queue size, or uploading. Server unreachable counts as offline for the cashier. */
function SyncChip({ outbox }: { outbox: OutboxSnapshot }) {
  const pending = outbox.pending.length - outbox.othersPending;
  const { phase } = outbox.sync;
  const offline = phase === "offline" || phase === "backoff";
  const waiting = [
    pending ? ` · ${pending} transaksi menunggu sinkron` : "",
    outbox.othersPending ? ` · ${outbox.othersPending} transaksi kasir lain menunggu` : "",
  ].join("");
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
