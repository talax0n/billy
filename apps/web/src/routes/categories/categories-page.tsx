import { type CategoryInput, categoryInput } from "@billy/core";
import { useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { Plus, Wand2 } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Dialog } from "../../components/ui/dialog.tsx";
import { Field, Input } from "../../components/ui/field.tsx";
import { EmptyState, PageBody, PageHeader } from "../../components/ui/page.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { useForm } from "../../lib/form.ts";

type CategoryRow = InferResponseType<typeof api.categories.$get, 200>["rows"][number];

export function CategoriesPage() {
  const paged = usePagedQuery(["categories"], (params) =>
    unwrap(api.categories.$get({ query: { q: params.q, page: String(params.page), pageSize: String(params.pageSize) } })),
  );
  const [editing, setEditing] = useState<CategoryRow | "new" | null>(null);
  const [autoAssigning, setAutoAssigning] = useState(false);

  return (
    <>
      <PageHeader title="Kategori" />
      <PageBody>
        <DataTable
          paged={paged}
          searchPlaceholder="Cari kategori…"
          toolbar={
            <>
              <Button className="ml-auto" onClick={() => setAutoAssigning(true)}>
                <Wand2 className="size-4" />
                Isi brand otomatis
              </Button>
              <Button variant="primary" onClick={() => setEditing("new")}>
                <Plus className="size-4" />
                Kategori baru
              </Button>
            </>
          }
          onRowClick={setEditing}
          empty={<EmptyState title="Belum ada kategori" />}
          columns={[
            { header: "Nama", cell: (c) => c.name },
            { header: "Keterangan", cell: (c) => <span className="text-ink-2">{c.description}</span> },
            { header: "Produk", align: "right", cell: (c) => c.productCount },
          ]}
        />
        <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Kategori baru" : "Ubah kategori"}>
          {editing && <CategoryForm category={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
        </Dialog>
        <Dialog open={autoAssigning} onClose={() => setAutoAssigning(false)} title="Isi brand otomatis">
          {autoAssigning && <AutoAssign onDone={() => setAutoAssigning(false)} />}
        </Dialog>
      </PageBody>
    </>
  );
}

function CategoryForm({ category, onDone }: { category: CategoryRow | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const initial: CategoryInput = category ?? { name: "", description: "" };
  const form = useForm(categoryInput, initial);
  const submit = form.onSubmit(async (json) => {
    await unwrap(
      category ? api.categories[":id"].$put({ param: { id: category.id }, json }) : api.categories.$post({ json }),
    );
    await queryClient.invalidateQueries({ queryKey: ["categories"] });
    toast("Kategori disimpan", "up");
    onDone();
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label="Nama" error={form.errors.name}>
        {(p) => <Input {...p} autoFocus value={form.values.name} onChange={(e) => form.set("name", e.target.value)} />}
      </Field>
      <Field label="Keterangan" error={form.errors.description}>
        {(p) => <Input {...p} value={form.values.description ?? ""} onChange={(e) => form.set("description", e.target.value)} />}
      </Field>
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Batal</Button>
        <Button type="submit" variant="primary" disabled={form.submitting}>
          Simpan
        </Button>
      </div>
    </form>
  );
}

type AutoAssignResult = InferResponseType<(typeof api.categories)["auto-assign"]["$post"], 200>;

/** Groups products without a category by the brand their name starts with, e.g. CATYLAC → Dulux. */
function AutoAssign({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<AutoAssignResult | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    try {
      setResult(await unwrap(api.categories["auto-assign"].$post()));
      await queryClient.invalidateQueries({ queryKey: ["categories"] });
      await queryClient.invalidateQueries({ queryKey: ["products"] });
    } finally {
      setRunning(false);
    }
  }

  if (result) {
    return (
      <div className="flex flex-col gap-4 text-sm">
        {result.assigned === 0 ? (
          <p className="text-ink-2">Tidak ada produk baru yang bisa dikenali brandnya.</p>
        ) : (
          <ul className="flex flex-col rounded-[10px] border border-line">
            {result.brands.map((b) => (
              <li key={b.id} className="flex justify-between border-b border-line-2 px-3 py-2 last:border-b-0">
                <span className="font-medium">{b.name}</span>
                <span className="tabular-nums">{b.count} produk</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button variant="primary" onClick={onDone}>
            Selesai
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-ink-2">
        Produk yang belum punya kategori akan dikelompokkan ke brandnya dari awal nama barang, misalnya CATYLAC dan WEATHERSHIELD masuk
        Dulux, VINILEX dan WEATHERBOND masuk Nippon Paint. Produk yang sudah punya kategori tidak diubah. Produk yang tidak dikenali tetap
        kosong dan bisa diisi manual.
      </p>
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Batal</Button>
        <Button variant="primary" disabled={running} onClick={run}>
          Isi sekarang
        </Button>
      </div>
    </div>
  );
}
