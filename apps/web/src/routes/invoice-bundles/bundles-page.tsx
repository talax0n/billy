import { businessDate, formatDate, formatRupiah, invoiceBundleInput, rupiah } from "@billy/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { InferResponseType } from "hono/client";
import { Ban, FileText, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { RevisionLinks } from "../../components/revision-links.tsx";
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
const amount = (value: number) => formatRupiah(rupiah(value), { symbol: false });

/** The create fields plus the reason an Ubah needs; the server requires it on an edit. */
const bundleForm = invoiceBundleInput.extend({ reason: z.string().trim().max(500).optional() });

export function BundlesPage() {
  const paged = usePagedQuery(["invoice-bundles"], (params) =>
    unwrap(
      api["invoice-bundles"].$get({ query: { q: params.q, page: String(params.page), pageSize: String(params.pageSize) } }),
    ),
  );
  /** The open bundle lives in the URL (`/tukar-faktur?id=…`) so other pages can link to it. */
  const search: { id?: string } = useSearch({ strict: false });
  const navigate = useNavigate();
  const openBundle = (id: string | null) => void navigate({ to: "/tukar-faktur", search: id ? { id } : {} });
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Tukar Faktur"
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Tukar faktur baru
          </Button>
        }
      />
      <PageBody>
        <DataTable
          paged={paged}
          searchPlaceholder="Cari nomor atau pelanggan…"
          onRowClick={(row) => openBundle(row.id)}
          empty={<EmptyState title="Belum ada tukar faktur" />}
          columns={[
            { header: "Nomor", cell: (b) => <span className="font-medium">{b.number}</span>, className: "whitespace-nowrap" },
            { header: "Pelanggan", cell: (b) => b.customerName },
            { header: "Tanggal", cell: (b) => formatDate(b.date), className: "whitespace-nowrap" },
            { header: "Faktur", align: "right", cell: (b) => b.invoiceCount },
            { header: "Total faktur (Rp)", align: "right", cell: (b) => amount(b.total) },
            { header: "Sisa tagihan (Rp)", align: "right", cell: (b) => amount(b.outstanding) },
            { header: "Status", cell: (b) => (b.voidedAt ? <Badge>Void</Badge> : <Badge tone="up">Aktif</Badge>) },
          ]}
        />
      </PageBody>
      {creating && (
        <Sheet open onClose={() => setCreating(false)} title="Tukar faktur baru">
          <BundleForm
            onSaved={(id) => {
              setCreating(false);
              openBundle(id);
            }}
          />
        </Sheet>
      )}
      {search.id && <BundleSheet bundleId={search.id} onOpen={openBundle} onClose={() => openBundle(null)} />}
    </>
  );
}

/** A new tukar faktur, or with `edit` an Ubah of a saved one: a corrected copy that replaces it. */
function BundleForm({ edit, onSaved }: { edit?: Bundle; onSaved: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [customer, setCustomer] = useState<Contact | null>(
    edit ? { id: edit.customer.id, code: edit.customer.code, name: edit.customer.name, paymentTermsDays: 0 } : null,
  );
  const form = useForm(
    bundleForm,
    edit
      ? { customerId: edit.customer.id, date: edit.date, note: edit.note, invoiceIds: edit.invoices.filter((i) => i.state.outstanding > 0).map((i) => i.id), reason: "" }
      : { customerId: "", date: businessDate(), note: "", invoiceIds: [] },
  );
  const invoices = useQuery({
    queryKey: ["sales", "list", "open", customer?.id],
    queryFn: () => unwrap(api.sales.$get({ query: { customerId: customer!.id, status: "open", pageSize: "100" } })),
    enabled: customer !== null,
  });
  const selected = new Set(form.values.invoiceIds);
  const selectedTotal = (invoices.data?.rows ?? []).filter((i) => selected.has(i.id)).reduce((sum, i) => sum + i.state.outstanding, 0);

  const submit = form.onSubmit(async ({ reason, ...input }) => {
    const saved = edit
      ? await unwrap(api["invoice-bundles"][":id"].edit.$post({ param: { id: edit.id }, json: { ...input, reason: reason ?? "" } }))
      : await unwrap(api["invoice-bundles"].$post({ json: input }));
    await queryClient.invalidateQueries({ queryKey: ["invoice-bundles"] });
    toast(edit ? `${edit.number} diubah menjadi ${saved.number}` : `${saved.number} dibuat`, "up");
    onSaved(saved.id);
  });

  return (
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
      {edit && (
        <Field label="Alasan perubahan" error={form.errors.reason}>
          {(p) => <Input {...p} value={form.values.reason ?? ""} onChange={(e) => form.set("reason", e.target.value)} />}
        </Field>
      )}
      <div className="flex items-center justify-between border-t border-line pt-3">
        <span className="text-ink-2">
          {selected.size} faktur · <span className="font-medium text-ink tabular-nums">{money(selectedTotal)}</span>
        </span>
        <Button type="submit" variant="primary" disabled={form.submitting}>
          {edit ? "Simpan perubahan" : "Simpan tukar faktur"}
        </Button>
      </div>
    </form>
  );
}

function BundleSheet({ bundleId, onOpen, onClose }: { bundleId: string; onOpen: (id: string) => void; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
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
    <Sheet
      open
      onClose={onClose}
      title={b ? (editing ? `Ubah ${b.number}` : b.number) : "Memuat…"}
      description={b && `${b.customer.name} · ${formatDate(b.date)}`}
    >
      {b &&
        (editing ? (
          <BundleForm
            edit={b}
            onSaved={(id) => {
              setEditing(false);
              onOpen(id);
            }}
          />
        ) : (
          <BundleDetail bundle={b} onVoid={() => setConfirming(true)} onEdit={() => setEditing(true)} />
        ))}
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

function BundleDetail({ bundle, onVoid, onEdit }: { bundle: Bundle; onVoid: () => void; onEdit: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        {bundle.voidedAt ? <Badge>Void</Badge> : <Badge tone="up">Aktif</Badge>}
        {bundle.voidReason && <span className="text-muted">Alasan void: {bundle.voidReason}</span>}
        <RevisionLinks path="/tukar-faktur" revisionOf={bundle.revisionOf} revisedBy={bundle.revisedBy} />
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => window.open(`/cetak/tukar-faktur/${bundle.id}`, "_blank", "noopener")}>
            <FileText className="size-3.5" />
            Cetak
          </Button>
          {!bundle.voidedAt && (
            <Button size="sm" onClick={onEdit}>
              <Pencil className="size-3.5" />
              Ubah
            </Button>
          )}
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
              <th className="px-4 py-2 text-right font-normal">Sisa (Rp)</th>
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
                <td className="px-4 py-2.5 text-right tabular-nums">{amount(inv.state.outstanding)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line font-medium">
            <tr>
              <td colSpan={3} className="px-4 py-2 text-right">
                Sisa tagihan
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{amount(bundle.outstanding)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {bundle.note && <p className="text-ink-2">Catatan: {bundle.note}</p>}
      <p className="text-xs text-muted">Dibuat {bundle.createdByName}</p>
    </div>
  );
}
