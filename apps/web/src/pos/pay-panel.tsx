import { type CartTotals, type Discount, type PosMethod, posMethods, quickTenderAmounts, rupiah, type Rupiah } from "@billy/core";
import type { Ref } from "react";
import { cx } from "../lib/cx.ts";
import { methodLabels } from "./receipt.tsx";
import { Kbd, money } from "./ui.tsx";

const methodKeys: Record<PosMethod, string> = { cash: "F5", qris: "F6", transfer: "F7" };

export function discountLabel(discount: Discount) {
  if (discount.kind === "percent") return `${(discount.value / 100).toLocaleString("id-ID")}%`;
  return "";
}

/** Totals, method, tendered cash and change. Computed values are text, never inputs. */
export function PayPanel({
  totals,
  error,
  discount,
  method,
  accountName,
  tendered,
  tenderRef,
  canPay,
  onMethod,
  onTendered,
  onTenderKey,
  onTxDiscount,
  onChooseAccount,
  onPay,
  paidBefore,
}: {
  totals: CartTotals;
  error: string | null;
  discount: Discount;
  method: PosMethod;
  accountName: string;
  /** 0 means not typed yet: the exact amount. */
  tendered: Rupiah;
  tenderRef: Ref<HTMLInputElement>;
  canPay: boolean;
  onMethod: (method: PosMethod) => void;
  onTendered: (value: Rupiah) => void;
  onTenderKey: (key: string) => void;
  onTxDiscount: () => void;
  onChooseAccount: () => void;
  onPay: () => void;
  /** A revisi: what the replaced nota already collected. Only the difference is paid or refunded. */
  paidBefore?: Rupiah | undefined;
}) {
  const cash = method === "cash";
  const due = totals.total - (paidBefore ?? 0);
  const collect = Math.max(due, 0);
  const received = cash && tendered > 0 ? tendered : collect;
  const change = received - due;
  return (
    <div className="flex flex-1 flex-col gap-3.5 px-[18px] py-4">
      <div className="flex justify-between text-ink-2">
        <span>Subtotal</span>
        <span className="tabular-nums">{money(totals.gross)}</span>
      </div>
      <div className="flex justify-between text-muted">
        <span>Diskon baris</span>
        <span className="tabular-nums">{totals.lineDiscount ? `−${money(totals.lineDiscount)}` : 0}</span>
      </div>
      <div className="flex justify-between text-muted">
        <span className="flex items-center gap-1.5">
          <button type="button" onClick={onTxDiscount} className="text-ink underline decoration-faint underline-offset-[3px]">
            {discount.kind === "none" ? "+ Diskon transaksi" : `Diskon transaksi ${discountLabel(discount)}`}
          </button>
          <Kbd>F4</Kbd>
        </span>
        <span className="tabular-nums">{totals.discountAmount ? `−${money(totals.discountAmount)}` : 0}</span>
      </div>

      <div className="border-t border-line pt-3">
        <div className="text-muted">Total</div>
        <div className="text-[38px] leading-[1.1] font-semibold tracking-[-0.03em] tabular-nums" data-testid="pos-total">
          <span className="mr-1 text-[22px] font-medium text-faint">Rp</span>
          {money(totals.total)}
        </div>
        {error && <p className="mt-1 text-down">{error}</p>}
        {paidBefore !== undefined && (
          <div className="mt-1 flex justify-between text-ink-2" data-testid="pos-difference">
            <span>{due < 0 ? "Dikembalikan tunai dari laci" : "Selisih dibayar"}</span>
            <span className="tabular-nums">
              Rp {money(Math.abs(due))} <span className="text-muted">(nota lama {money(paidBefore)})</span>
            </span>
          </div>
        )}
      </div>

      <div>
        <div className="mb-1.5 text-xs text-muted">Metode bayar</div>
        <div role="radiogroup" aria-label="Metode bayar" className="grid grid-cols-3 gap-1.5">
          {posMethods.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={m === method}
              onClick={() => onMethod(m)}
              className={cx(
                "flex items-center justify-between rounded-[9px] border px-2.5 py-2.5",
                m === method ? "border-[1.5px] border-ink font-medium" : "border-line text-ink-2",
              )}
            >
              {methodLabels[m]} <Kbd>{methodKeys[m]}</Kbd>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs text-muted">
          {cash ? "Uang diterima" : "Diterima"} · masuk ke{" "}
          <button type="button" onClick={onChooseAccount} className="font-medium text-ink hover:underline" title="Ganti akun">
            {accountName}
          </button>
        </div>
        <label
          className={cx(
            "flex items-center gap-2 rounded-[10px] border-[1.5px] px-3 py-2 text-xl font-medium focus-within:border-ink",
            cash ? "border-line" : "border-line-2 text-ink-2",
          )}
        >
          <span className="text-faint">Rp</span>
          <input
            ref={tenderRef}
            inputMode="numeric"
            aria-label="Uang diterima"
            disabled={!cash}
            value={cash ? (tendered ? money(tendered) : "") : money(collect)}
            placeholder={money(collect)}
            onChange={(e) => onTendered(rupiah(Number(e.target.value.replace(/\D/g, "").slice(0, 13) || 0)))}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") {
                e.preventDefault();
                onTenderKey(e.key);
              }
            }}
            className="min-w-0 flex-1 bg-transparent tabular-nums outline-none placeholder:text-faint"
          />
        </label>
        {cash && (
          <div className="mt-1.5 grid grid-cols-4 gap-1.5">
            {[{ label: "Uang pas", value: rupiah(collect) }, ...quickTenderAmounts(rupiah(collect)).map((v) => ({ label: money(v), value: v }))].map(
              (chip) => (
                <button
                  key={chip.label}
                  type="button"
                  disabled={collect === 0}
                  onClick={() => onTendered(chip.value)}
                  className="rounded-lg border border-line py-1.5 text-xs text-ink-2 tabular-nums hover:bg-line-2 disabled:opacity-50"
                >
                  {chip.label}
                </button>
              ),
            )}
          </div>
        )}
      </div>

      <div className="flex items-baseline justify-between rounded-[10px] bg-line-2 px-3 py-2.5">
        <span>{change < 0 ? "Kurang" : "Kembalian"}</span>
        <b className={cx("text-[22px] font-semibold tabular-nums", change < 0 ? "text-down" : "text-up")} data-testid="pos-change">
          Rp {money(Math.abs(change))}
        </b>
      </div>

      <button
        type="button"
        disabled={!canPay}
        onClick={onPay}
        className="mt-auto flex items-center justify-between rounded-[11px] bg-ink px-4 py-3.5 text-[15px] font-semibold text-panel disabled:opacity-40"
      >
        {paidBefore === undefined ? "Bayar & cetak struk" : "Simpan revisi & cetak struk"}
        <kbd className="rounded-[5px] border border-panel/35 px-1.5 py-px font-sans text-xs font-normal">Enter</kbd>
      </button>
    </div>
  );
}
