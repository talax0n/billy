import { type ApprovalInput, type Discount, posDraftCancelInput, type Rupiah } from "@billy/core";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { type FormEvent, useState } from "react";
import { ApprovalDialog } from "../components/approval-dialog.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Dialog } from "../components/ui/dialog.tsx";
import { Field, Input } from "../components/ui/field.tsx";
import { toast } from "../components/ui/toast.tsx";
import { api, ApiError, unwrap } from "../lib/api.ts";
import { useForm } from "../lib/form.ts";
import type { Cart, CartLine } from "./cart.ts";
import type { Catalog } from "./local.ts";
import type { ReceiptData } from "./receipt.tsx";
import { money } from "./ui.tsx";

export type DraftDetail = InferResponseType<(typeof api.pos.drafts)[":id"]["$get"], 200>;
type SaleDetail = InferResponseType<(typeof api.pos.sales)[":id"]["$get"], 200>;

/** Open nota sementara, the same on every Kasir device. Online only: offline the query just fails. */
export const openDraftsQuery = queryOptions({
  queryKey: ["pos", "drafts"],
  queryFn: () => unwrap(api.pos.drafts.$get()),
  networkMode: "always",
  refetchInterval: 15_000,
});

export function cartFromDraft(draft: DraftDetail, catalog: Catalog): Cart {
  return {
    lines: draft.lines.map(({ productId, name, variant, unit, categoryName, unitPrice, qty, discountAmount, note }) => ({
      productId,
      name,
      variant,
      unit,
      categoryName,
      unitPrice,
      qty,
      discountAmount,
      note,
    })),
    discount: { kind: draft.discountKind, value: draft.discountValue } as Discount,
    selected: 0,
    customer: catalog.customers.find((c) => c.id === draft.customerId) ?? null,
  };
}

/** The paid nota's lines in the cart, for a revisi. */
export function cartFromSale(sale: SaleDetail, catalog: Catalog): Cart {
  const lines: CartLine[] = sale.lines.map((l) => ({
    productId: l.productId,
    name: l.productName,
    variant: l.variant,
    unit: l.unit,
    categoryName: catalog.products.find((p) => p.id === l.productId)?.categoryName ?? null,
    unitPrice: l.unitPrice,
    qty: l.qty,
    discountAmount: l.discountAmount,
    note: l.note,
  }));
  return {
    lines,
    discount: { kind: sale.discountKind, value: sale.discountValue } as Discount,
    selected: 0,
    customer: catalog.customers.find((c) => c.id === sale.customerId) ?? null,
  };
}

/** "NOTA SEMENTARA, BUKAN BUKTI PEMBAYARAN": the lines and total, no payment. */
export function draftReceipt(draft: DraftDetail): ReceiptData {
  const lineDiscount = draft.lines.reduce((sum, l) => sum + l.discountAmount, 0) as Rupiah;
  return {
    number: draft.number,
    soldAt: draft.updatedAt,
    cashierName: draft.createdByName,
    method: "cash",
    accountName: "",
    lines: draft.lines.map((l) => ({ ...l, name: `${l.name} ${l.variant}`.trim() })),
    gross: (draft.subtotal + lineDiscount) as Rupiah,
    lineDiscount,
    discountAmount: draft.discountAmount,
    total: draft.total,
    tendered: 0 as Rupiah,
    change: 0 as Rupiah,
    draft: true,
  };
}

const time = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

/**
 * The open nota sementara: save the cart as one (or save changes to the loaded one), open one
 * into the cart on this device, print it, or cancel it.
 */
export function DraftsDialog({
  cartHasLines,
  active,
  onSave,
  onOpen,
  onPrint,
  onClose,
}: {
  cartHasLines: boolean;
  active: { id: string; number: string } | null;
  onSave: () => Promise<void>;
  onOpen: (draft: DraftDetail) => void;
  onPrint: (receipt: ReceiptData) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const drafts = useQuery(openDraftsQuery);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<{ id: string; number: string } | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      toast((err as Error).message, "down");
    } finally {
      setBusy(false);
    }
  }
  const open = (id: string) => run(async () => onOpen(await unwrap(api.pos.drafts[":id"].$get({ param: { id } }))));
  const print = (id: string) =>
    run(async () => {
      onPrint(draftReceipt(await unwrap(api.pos.drafts[":id"].print.$post({ param: { id } }))));
      await queryClient.invalidateQueries({ queryKey: openDraftsQuery.queryKey });
    });

  if (cancelling) return <CancelDraftDialog draft={cancelling} onClose={() => setCancelling(null)} />;
  return (
    <Dialog open onClose={onClose} title="Nota sementara" description="Belum dibayar. Bisa dibuka dan dibayar dari perangkat kasir mana pun." className="max-w-xl">
      <div className="flex flex-col gap-3">
        {cartHasLines && (
          <Button variant="primary" disabled={busy} onClick={() => void run(onSave)} className="justify-center">
            {active ? `Simpan perubahan ${active.number}` : "Simpan sebagai nota sementara"}
          </Button>
        )}
        {drafts.isError && <p className="py-4 text-center text-muted">Nota sementara hanya bisa dibuka saat online.</p>}
        {drafts.data?.rows.length === 0 && <p className="py-4 text-center text-muted">Tidak ada nota sementara terbuka.</p>}
        <ul className="flex flex-col">
          {drafts.data?.rows.map((d) => (
            <li key={d.id} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-line-2 py-2 last:border-b-0">
              <span>
                <span className="flex items-center gap-2">
                  {d.number}
                  {d.printCount > 0 && <Badge tone="warn">Dicetak {d.printCount}×</Badge>}
                  {active?.id === d.id && <Badge tone="up">Di keranjang</Badge>}
                </span>
                <small className="block text-muted">
                  {d.createdByName} · {time.format(new Date(d.createdAt))} · {d.customerName ?? "Umum"} · Rp {money(d.total)}
                </small>
              </span>
              <span className="flex gap-1.5">
                <Button size="sm" disabled={busy || cartHasLines} title={cartHasLines ? "Kosongkan keranjang dulu" : undefined} onClick={() => void open(d.id)} aria-label={`Buka ${d.number}`}>
                  Buka
                </Button>
                <Button size="sm" disabled={busy} onClick={() => void print(d.id)} aria-label={`Cetak ${d.number}`}>
                  Cetak
                </Button>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => setCancelling(d)} aria-label={`Batalkan ${d.number}`}>
                  Batal
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}

/** Cancelling asks a reason; once printed, a non-admin also needs an admin's approval. Nothing is deleted. */
function CancelDraftDialog({ draft, onClose }: { draft: { id: string; number: string }; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [blocked, setBlocked] = useState<{ reason: string; message: string } | null>(null);
  const form = useForm(posDraftCancelInput, { reason: "" });

  async function send(reason: string, approval?: ApprovalInput) {
    await unwrap(api.pos.drafts[":id"].cancel.$post({ param: { id: draft.id }, json: { reason, ...(approval && { approval }) } }));
    await queryClient.invalidateQueries({ queryKey: openDraftsQuery.queryKey });
    toast(`${draft.number} dibatalkan`, "up");
    onClose();
  }

  const submit = form.onSubmit(async ({ reason }) => {
    try {
      await send(reason);
    } catch (err) {
      if (err instanceof ApiError && err.approval) setBlocked({ reason, message: err.message });
      else throw err;
    }
  });

  if (blocked) {
    return (
      <ApprovalDialog
        message={blocked.message}
        request={{ action: "pos.draft.cancel", draftId: draft.id }}
        submit={(approval) => send(blocked.reason, approval)}
        onClose={onClose}
      />
    );
  }
  return (
    <Dialog open onClose={onClose} title={`Batalkan ${draft.number}`} description="Nota sementara tidak dihapus; statusnya menjadi dibatalkan.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Alasan" error={form.errors.reason}>
          {(p) => <Input {...p} autoFocus value={form.values.reason} onChange={(e) => form.set("reason", e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Kembali</Button>
          <Button type="submit" variant="danger" disabled={form.submitting}>
            Batalkan nota
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Revisi starts with its reason; the paid nota's lines then load into the cart to be changed. */
export function RevisiDialog({ number, onStart, onClose }: { number: string; onStart: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim()) onStart(reason.trim());
    else setError("Alasan revisi wajib diisi");
  };
  return (
    <Dialog open onClose={onClose} title={`Revisi ${number}`} description="Nota lama dibatalkan dan diganti nota baru. Selisih dibayar atau dikembalikan tunai dari laci.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Alasan revisi" error={error}>
          {(p) => <Input {...p} autoFocus maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Batal</Button>
          <Button type="submit" variant="primary">
            Mulai revisi
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
