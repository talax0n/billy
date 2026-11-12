import { type CategoryInput, categoryInput } from "@billy/core";
import { useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Dialog } from "../../components/ui/dialog.tsx";
import { Field, Input } from "../../components/ui/field.tsx";
import { EmptyState, PageBody } from "../../components/ui/page.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { useForm } from "../../lib/form.ts";

type CategoryRow = InferResponseType<typeof api.categories.$get, 200>["rows"][number];

export function CategoriesTab() {
  const paged = usePagedQuery(["categories"], (params) =>
    unwrap(api.categories.$get({ query: { q: params.q, page: String(params.page), pageSize: String(params.pageSize) } })),
  );
  const [editing, setEditing] = useState<CategoryRow | "new" | null>(null);

  return (
    <PageBody>
      <DataTable
        paged={paged}
        searchPlaceholder="Cari kategori…"
        toolbar={
          <Button variant="primary" className="ml-auto" onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            Kategori baru
          </Button>
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
    </PageBody>
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
