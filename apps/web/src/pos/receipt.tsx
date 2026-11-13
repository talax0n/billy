import type { PosMethod, Rupiah } from "@billy/core";
import type { InferResponseType } from "hono/client";
import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { api, unwrap } from "../lib/api.ts";
import { desktop } from "../lib/desktop.ts";

/** Everything a receipt shows. Built from the cart at sale time, or from a stored sale for reprints. */
export interface ReceiptData {
  number: string;
  soldAt: string;
  cashierName: string;
  method: PosMethod;
  accountName: string;
  lines: { name: string; unit: string; qty: number; unitPrice: Rupiah; discountAmount: Rupiah; lineTotal: Rupiah; note: string }[];
  gross: Rupiah;
  lineDiscount: Rupiah;
  discountAmount: Rupiah;
  total: Rupiah;
  tendered: Rupiah;
  change: Rupiah;
  voided?: boolean;
  /** Set on the server's sale id once known, so a reprint can be counted. */
  saleId?: string;
  /** A reprint: says SALINAN. */
  copy?: boolean;
  /** A revisi: the nota it replaced, whose total was already paid. */
  revisionOf?: { number: string; total: Rupiah } | undefined;
  /** A nota sementara: not a proof of payment, printed without payment rows. */
  draft?: boolean;
}

export interface ReceiptShop {
  shopName: string;
  address: string;
  phone: string;
  receiptFooter: string;
}

export type PaperWidth = 58 | 80;

export const methodLabels: Record<PosMethod, string> = { cash: "Tunai", qris: "QRIS", transfer: "Transfer" };

type StoredSale = InferResponseType<(typeof api.pos.sales)[":id"]["$get"], 200>;

export function receiptFromSale(sale: StoredSale): ReceiptData {
  const lineDiscount = sale.lines.reduce((sum, l) => sum + l.discountAmount, 0) as Rupiah;
  return {
    number: sale.number,
    soldAt: sale.soldAt,
    cashierName: sale.cashierName,
    method: sale.method,
    accountName: sale.accountName,
    lines: sale.lines.map((l) => ({ ...l, name: `${l.productName} ${l.variant}`.trim() })),
    gross: (sale.subtotal + lineDiscount) as Rupiah,
    lineDiscount,
    discountAmount: sale.discountAmount,
    total: sale.total,
    tendered: sale.tendered,
    change: sale.change,
    voided: sale.voidedAt !== null,
    saleId: sale.id,
    revisionOf: sale.revisionOfNumber && sale.revisionOfTotal !== null ? { number: sale.revisionOfNumber, total: sale.revisionOfTotal } : undefined,
  };
}

/** A reprint of a sale the server holds: counted there, and printed as SALINAN. */
export async function countedReprint(id: string): Promise<ReceiptData> {
  return { ...receiptFromSale(await unwrap(api.pos.sales[":id"].print.$post({ param: { id } }))), copy: true };
}

const idr = new Intl.NumberFormat("id-ID");
const n = (value: number) => idr.format(value);
const stamp = new Intl.DateTimeFormat("id-ID", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jakarta" });

/**
 * A thermal receipt (58 or 80 mm). Monospace and black on white whatever the theme, because
 * it is paper.
 */
export function Receipt({ receipt: r, shop, width = 80 }: { receipt: ReceiptData; shop: ReceiptShop; width?: PaperWidth }) {
  const row = "flex justify-between gap-2";
  return (
    <div
      className="bg-white p-[3mm] font-mono text-[11px] leading-snug text-black"
      style={{ width: `${width}mm` }}
      data-testid="receipt"
    >
      <div className="text-center">
        <div className="text-[13px] font-bold">{shop.shopName}</div>
        {shop.address && <div>{shop.address}</div>}
        {shop.phone && <div>Telp {shop.phone}</div>}
      </div>
      <div className="my-1.5 border-t border-dashed border-black" />
      <div className={row}>
        <span>{r.number}</span>
        <span>{stamp.format(new Date(r.soldAt))}</span>
      </div>
      <div>Kasir: {r.cashierName}</div>
      {r.draft && (
        <div className="text-center font-bold">
          NOTA SEMENTARA
          <br />
          BUKAN BUKTI PEMBAYARAN
        </div>
      )}
      {r.copy && <div className="text-center font-bold">SALINAN</div>}
      {r.voided && <div className="text-center font-bold">*** VOID ***</div>}
      {r.revisionOf && <div>Revisi dari {r.revisionOf.number}</div>}
      <div className="my-1.5 border-t border-dashed border-black" />
      {r.lines.map((line, i) => (
        <div key={i} className="mb-1">
          <div>{line.name}</div>
          <div className={row}>
            <span>
              {line.qty} {line.unit} × {n(line.unitPrice)}
            </span>
            <span>{n(line.qty * line.unitPrice)}</span>
          </div>
          {line.discountAmount > 0 && (
            <div className={row}>
              <span>  Diskon</span>
              <span>-{n(line.discountAmount)}</span>
            </div>
          )}
          {line.note && (
            <div>
              {line.note}
              <br />
              Cat tinting tidak bisa diretur
            </div>
          )}
        </div>
      ))}
      <div className="my-1.5 border-t border-dashed border-black" />
      <div className={row}>
        <span>Subtotal</span>
        <span>{n(r.gross)}</span>
      </div>
      {r.lineDiscount > 0 && (
        <div className={row}>
          <span>Diskon baris</span>
          <span>-{n(r.lineDiscount)}</span>
        </div>
      )}
      {r.discountAmount > 0 && (
        <div className={row}>
          <span>Diskon transaksi</span>
          <span>-{n(r.discountAmount)}</span>
        </div>
      )}
      <div className={`${row} text-[13px] font-bold`}>
        <span>TOTAL</span>
        <span>{n(r.total)}</span>
      </div>
      {r.revisionOf && (
        <div className={row}>
          <span>Dibayar di {r.revisionOf.number}</span>
          <span>{n(r.revisionOf.total)}</span>
        </div>
      )}
      {!r.draft && (
        <>
          <div className={row}>
            <span>
              {methodLabels[r.method]} ({r.accountName})
            </span>
            <span>{n(r.tendered)}</span>
          </div>
          <div className={row}>
            <span>Kembali</span>
            <span>{n(r.change)}</span>
          </div>
        </>
      )}
      {shop.receiptFooter && (
        <>
          <div className="my-1.5 border-t border-dashed border-black" />
          <div className="text-center whitespace-pre-line">{shop.receiptFooter}</div>
        </>
      )}
    </div>
  );
}

interface PrintJob {
  receipt: ReceiptData;
  shop: ReceiptShop;
  width: PaperWidth;
}

let job: PrintJob | null = null;
const listeners = new Set<() => void>();

/** Prints a receipt: silently in the desktop app, else through the browser dialog. Mount `<ReceiptPrinter />` once on the page. */
export function printReceipt(receipt: ReceiptData, shop: ReceiptShop, width: PaperWidth = 80) {
  job = { receipt, shop, width };
  for (const listener of listeners) listener();
}

/** Renders the pending print job outside the app root and prints the page once it is in the DOM. */
export function ReceiptPrinter() {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => job,
  );
  useEffect(() => {
    if (!current) return;
    // A failed silent print (printer offline, wrong name) falls back to the dialog, so the cashier can pick another.
    if (desktop) desktop.printReceipt().catch(() => window.print());
    else window.print();
  }, [current]);
  if (!current) return null;
  return createPortal(
    <div id="pos-receipt">
      <style>{`
        #pos-receipt { display: none; }
        @media print {
          @page { size: ${current.width}mm auto; margin: 0; }
          body > #root { display: none; }
          body { background: #fff; }
          #pos-receipt { display: block; }
        }
      `}</style>
      <Receipt receipt={current.receipt} shop={current.shop} width={current.width} />
    </div>,
    document.body,
  );
}
