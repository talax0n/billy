import { businessDate, formatDate, formatRupiah, invoiceBundleInput, rupiah } from "@billy/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { Ban, FileText, Plus } from "lucide-react";
import { useState } from "react";
import { Badge, StatusTag } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Dialog, Sheet } from "../../components/ui/dialog.tsx";
import { DateInput, Field, Input } from "../../components/ui/field.tsx";
import { EmptyState, PageBody, PageHeader } from "../../components/ui/page.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { useForm } from "../../lib/form.ts";
import { type Contact, LookupPicker, lookups } from "../../components/lookup-picker.tsx";

type Bundle = InferResponseType<(typeof api)["invoice-bundles"][":id"]["$get"], 200>;

const money = (value: number) => formatRupiah(rupiah(value));

export function BundlesPage() {
  const paged = usePagedQuery(["invoice-bundles"], (params) =>
    unwrap(
      api["invoice-bundles"].$get({ query: { q: params.q, page: String(params.page), pageSize: String(params.pageSize) } }),
    ),
  );
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Tukar Faktur"
        actions={
          <Button variant="primary" onClick={() => setOpen("new")}>
            <Plus className="size-4" />
            Tukar faktur baru
          </Button>
        }
      />
      <PageBody>
        <DataTable
          paged={paged}
          searchPlaceholder="Cari nomor atau pelanggan…"
          onRowClick={(row) => setOpen(row.id)}
          empty={<EmptyState title="Belum ada tukar faktur" />}
          columns={[
            { header: "Nomor", cell: (b) => <span className="font-medium">{b.number}</span>, className: "whitespace-nowrap" },
            { header: "Pelanggan", cell: (b) => b.customerName },
            { header: "Tanggal", cell: (b) => formatDate(b.date), className: "whitespace-nowrap" },
            { header: "Faktur", align: "right", cell: (b) => b.invoiceCount },
            { header: "Total faktur", align: "right", cell: (b) => money(b.total) },
            { header: "Sisa tagihan", align: "right", cell: (b) => money(b.outstanding) },
            { header: "Status", cell: (b) => (b.voidedAt ? <Badge>Void</Badge> : <Badge tone="up">Aktif</Badge>) },
          ]}
        />
      </PageBody>
      {open === "new" && <NewBundleSheet onSaved={setOpen} onClose={() => setOpen(null)} />}
      {open && open !== "new" && <BundleSheet bundleId={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function NewBundleSheet({ onSaved, onClose }: { onSaved: (id: string) => void; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [customer, setCustomer] = useState<Contact | null>(null);
  const form = useForm(invoiceBundleInput, { customerId: "", date: businessDate(), note: "", invoiceIds: [] });
  const invoices = useQuery({
    queryKey: ["sales", "list", "open", customer?.id],
    queryFn: () => unwrap(api.sales.$get({ query: { customerId: customer!.id, status: "open", pageSize: "100" } })),
    enabled: customer !== null,
  });
  const selected = new Set(form.values.invoiceIds);
  const selectedTotal = (invoices.data?.rows ?? []).filter((i) => selected.has(i.id)).reduce((sum, i) => sum + i.state.outstanding, 0);

  const submit = form.onSubmit(async (input) => {
    const saved = await unwrap(api["invoice-bundles"].$post({ json: input }));
    await queryClient.invalidateQueries({ queryKey: ["invoice-bundles"] });
    toast(`${saved.number} dibuat`, "up");
    onSaved(saved.id);
  });

  return (
    <Sheet open onClose={onClose} title="Tukar faktur baru">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Pelanggan" error={form.errors.customerId}>
          {(p) => (
            <LookupPicker
              {...p}
              kind="customer"
              lookup={lookups.customer}
              value={customer}
              placeholder="Cari pelanggan…"
              onChange={(c) => {
                setCustomer(c);
                form.setValues((v) => ({ ...v, customerId: c?.id ?? "", invoiceIds: [] }));
              }}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tanggal" error={form.errors.date}>
            {(p) => <DateInput {...p} value={form.values.date} onChange={(e) => form.set("date", e.target.value)} />}
          </Field>
          <Field label="Catatan" error={form.errors.note}>
            {(p) => <Input {...p} value={form.values.note ?? ""} onChange={(e) => form.set("note", e.target.value)} />}
          </Field>
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1.5 text-ink-2">Faktur belum lunas</legend>
          {!customer && <p className="text-muted">Pilih pelanggan dulu.</p>}
          {invoices.data?.rows.length === 0 && <p className="text-muted">Pelanggan ini tidak punya faktur belum lunas.</p>}
          {invoices.data?.rows.map((inv) => (
            <label key={inv.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-line-2">
              <input
                type="checkbox"
                checked={selected.has(inv.id)}
                onChange={(e) =>
                  form.set(
                    "invoiceIds",
                    e.target.checked ? [...form.values.invoiceIds, inv.id] : form.values.invoiceIds.filter((id) => id !== inv.id),
                  )
                }
              />
              <span className="flex-1">
                <span className="font-medium">{inv.number}</span>
                <span className="ml-2 text-muted">jatuh tempo {formatDate(inv.dueDate)}</span>
              </span>
              <StatusTag state={inv.state} />
              <span className="w-32 text-right tabular-nums">{money(inv.state.outstanding)}</span>
            </label>
          ))}
          {form.errors.invoiceIds && <p className="text-xs text-down">{form.errors.invoiceIds}</p>}
        </fieldset>
        <div className="flex items-center justify-between border-t border-line pt-3">
          <span className="text-ink-2">
            {selected.size} faktur · <span className="font-medium text-ink tabular-nums">{money(selectedTotal)}</span>
          </span>
          <Button type="submit" variant="primary" disabled={form.submitting}>
            Simpan tukar faktur
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function BundleSheet({ bundleId, onClose }: { bundleId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const bundle = useQuery({
    queryKey: ["invoice-bundles", bundleId],
    queryFn: () => unwrap(api["invoice-bundles"][":id"].$get({ param: { id: bundleId } })),
  });
  const b = bundle.data;

  async function voidBundle() {
    await unwrap(api["invoice-bundles"][":id"].void.$post({ param: { id: bundleId } }));
    await queryClient.invalidateQueries({ queryKey: ["invoice-bundles"] });
    toast(`${b!.number} di-void`, "up");
    setConfirming(false);
  }

  return (
    <Sheet open onClose={onClose} title={b?.number ?? "Memuat…"} description={b && `${b.customer.name} · ${formatDate(b.date)}`}>
      {b && <BundleDetail bundle={b} onVoid={() => setConfirming(true)} />}
      {b && (
        <Dialog
          open={confirming}
          onClose={() => setConfirming(false)}
          title="Void tukar faktur"
          description={`${b.number}. Fakturnya tetap ada dan bisa ditukar lagi.`}
        >
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirming(false)}>Batal</Button>
            <Button variant="danger" onClick={() => void voidBundle().catch((err: Error) => toast(err.message, "down"))}>
              Void
            </Button>
          </div>
        </Dialog>
      )}
    </Sheet>
  );
}

function BundleDetail({ bundle, onVoid }: { bundle: Bundle; onVoid: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        {bundle.voidedAt ? <Badge>Void</Badge> : <Badge tone="up">Aktif</Badge>}
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => window.open(`/cetak/tukar-faktur/${bundle.id}`, "_blank", "noopener")}>
            <FileText className="size-3.5" />
            Cetak
          </Button>
          {!bundle.voidedAt && (
            <Button size="sm" variant="danger" onClick={onVoid}>
              <Ban className="size-3.5" />
              Void
            </Button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[520px] border-collapse">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-2 font-normal">Faktur</th>
              <th className="px-2 py-2 font-normal">Jatuh tempo</th>
              <th className="px-2 py-2 font-normal">Status</th>
              <th className="px-4 py-2 text-right font-normal">Sisa</th>
            </tr>
          </thead>
          <tbody>
            {bundle.invoices.map((inv) => (
              <tr key={inv.id} className="border-b border-line-2 last:border-b-0">
                <td className="px-4 py-2.5 font-medium">{inv.number}</td>
                <td className="px-2 py-2.5">{formatDate(inv.dueDate)}</td>
                <td className="px-2 py-2.5">
                  <StatusTag state={inv.state} />
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(inv.state.outstanding)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line font-medium">
            <tr>
              <td colSpan={3} className="px-4 py-2 text-right">
                Sisa tagihan
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{money(bundle.outstanding)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {bundle.note && <p className="text-ink-2">Catatan: {bundle.note}</p>}
      <p className="text-xs text-muted">Dibuat {bundle.createdByName}</p>
    </div>
  );
}
