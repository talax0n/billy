import { type CartTotals, type DeliveryDetailsInput, type Discount, type PosMethod, posMethods, quickTenderAmounts, rupiah, type Rupiah } from "@billy/core";
import type { Ref } from "react";
import { cx } from "../lib/cx.ts";
import { methodLabels } from "./receipt.tsx";
import { money } from "./ui.tsx";

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
  delivery,
  onDelivery,
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
  /** "Diantar ke alamat": null while off. Not offered on a revisi. */
  delivery: Required<DeliveryDetailsInput> | null;
  onDelivery: (delivery: Required<DeliveryDetailsInput> | null) => void;
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
                "rounded-[9px] border px-2.5 py-2.5",
                m === method ? "border-[1.5px] border-ink font-medium" : "border-line text-ink-2",
              )}
            >
              {methodLabels[m]}
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

      {paidBefore === undefined && <DeliveryFields delivery={delivery} onDelivery={onDelivery} />}

      <button
        type="button"
        disabled={!canPay}
        onClick={onPay}
        className="sticky bottom-0 mt-auto rounded-[11px] bg-ink px-4 py-3.5 shadow-[0_-8px_16px_var(--panel)] text-[15px] font-semibold text-panel disabled:opacity-40"
      >
        {paidBefore === undefined ? "Bayar & cetak struk" : "Simpan revisi & cetak struk"}
      </button>
    </div>
  );
}

const fieldClass = "w-full rounded-lg border border-line bg-panel px-2.5 py-2 placeholder:text-faint focus:border-ink focus:outline-none";

/** The toggle and, when on, where the goods go. The address is required to pay. */
function DeliveryFields({ delivery, onDelivery }: { delivery: Required<DeliveryDetailsInput> | null; onDelivery: (delivery: Required<DeliveryDetailsInput> | null) => void }) {
  const set = (key: keyof DeliveryDetailsInput, value: string) => delivery && onDelivery({ ...delivery, [key]: value });
  return (
    <div className={cx("rounded-[10px] border", delivery ? "border-ink" : "border-line")}>
      <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5 font-medium">
        <input
          type="checkbox"
          className="size-[18px] accent-ink"
          checked={delivery !== null}
          onChange={(e) => onDelivery(e.target.checked ? { customerName: "", address: "", phone: "", note: "" } : null)}
        />
        Diantar ke alamat
        {delivery && <span className="ml-auto text-xs font-normal text-muted">masuk Antrian Antar</span>}
      </label>
      {delivery && (
        <div className="flex flex-col gap-2 border-t border-line px-3 pt-2.5 pb-3">
          <input aria-label="Nama penerima" placeholder="Nama penerima" className={fieldClass} value={delivery.customerName} onChange={(e) => set("customerName", e.target.value)} />
          <textarea
            aria-label="Alamat antar"
            placeholder="Alamat antar (wajib)"
            rows={2}
            className={cx(fieldClass, "resize-none", !delivery.address.trim() && "border-warn")}
            value={delivery.address}
            onChange={(e) => set("address", e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <input aria-label="Telepon penerima" placeholder="Telepon" inputMode="tel" className={fieldClass} value={delivery.phone} onChange={(e) => set("phone", e.target.value)} />
            <input aria-label="Catatan antar" placeholder="Catatan untuk sopir" className={fieldClass} value={delivery.note} onChange={(e) => set("note", e.target.value)} />
          </div>
          {!delivery.address.trim() && <p className="text-xs text-warn">Isi alamat dulu supaya bisa dibayar.</p>}
        </div>
      )}
    </div>
  );
}
