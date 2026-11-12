import { roleLabels, roles, userCreateInput, userUpdateInput } from "@billy/core";
import { useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Sheet } from "../../components/ui/dialog.tsx";
import { Field, Input, Select } from "../../components/ui/field.tsx";
import { EmptyState, PageBody } from "../../components/ui/page.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { useForm } from "../../lib/form.ts";

type UserRow = InferResponseType<typeof api.users.$get, 200>["rows"][number];

export function UsersTab() {
  const paged = usePagedQuery(["users"], (params) =>
    unwrap(api.users.$get({ query: { q: params.q, page: String(params.page), pageSize: String(params.pageSize) } })),
  );
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);

  return (
    <PageBody>
      <DataTable
        paged={paged}
        searchPlaceholder="Cari nama atau nama pengguna…"
        toolbar={
          <Button variant="primary" className="ml-auto" onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            Pengguna baru
          </Button>
        }
        onRowClick={setEditing}
        empty={<EmptyState title="Belum ada pengguna" />}
        columns={[
          { header: "Nama", cell: (u) => u.name },
          { header: "Nama pengguna", cell: (u) => <span className="text-ink-2">{u.username}</span> },
          { header: "Peran", cell: (u) => roleLabels[u.role] },
          { header: "Status", cell: (u) => (u.active ? <Badge tone="up">Aktif</Badge> : <Badge>Nonaktif</Badge>) },
        ]}
      />
      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Pengguna baru" : "Ubah pengguna"}>
        {editing === "new" && <CreateUserForm onDone={() => setEditing(null)} />}
        {editing && editing !== "new" && <EditUserForm user={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </PageBody>
  );
}

function RoleSelect({ value, onChange, ...props }: { value: string; onChange: (role: (typeof roles)[number]) => void; id: string }) {
  return (
    <Select {...props} value={value} onChange={(e) => onChange(e.target.value as (typeof roles)[number])}>
      {roles.map((role) => (
        <option key={role} value={role}>
          {roleLabels[role]}
        </option>
      ))}
    </Select>
  );
}

function useSaved(onDone: () => void) {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ["users"] });
    toast("Pengguna disimpan", "up");
    onDone();
  };
}

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const saved = useSaved(onDone);
  const form = useForm(userCreateInput, { username: "", name: "", role: "kasir", password: "" });
  const submit = form.onSubmit(async (json) => {
    await unwrap(api.users.$post({ json }));
    await saved();
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label="Nama" error={form.errors.name}>
        {(p) => <Input {...p} autoFocus value={form.values.name} onChange={(e) => form.set("name", e.target.value)} />}
      </Field>
      <Field label="Nama pengguna" hint="Untuk masuk. Huruf kecil, tanpa spasi." error={form.errors.username}>
        {(p) => <Input {...p} autoComplete="off" value={form.values.username} onChange={(e) => form.set("username", e.target.value)} />}
      </Field>
      <Field label="Peran" error={form.errors.role}>
        {(p) => <RoleSelect {...p} value={form.values.role} onChange={(role) => form.set("role", role)} />}
      </Field>
      <Field label="Kata sandi" hint="Minimal 8 karakter" error={form.errors.password}>
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="new-password"
            value={form.values.password}
            onChange={(e) => form.set("password", e.target.value)}
          />
        )}
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={form.submitting}>
          Buat pengguna
        </Button>
      </div>
    </form>
  );
}

function EditUserForm({ user, onDone }: { user: UserRow; onDone: () => void }) {
  const saved = useSaved(onDone);
  const form = useForm(userUpdateInput, { name: user.name, role: user.role, active: user.active, password: "" });
  const submit = form.onSubmit(async (json) => {
    await unwrap(api.users[":id"].$put({ param: { id: user.id }, json }));
    await saved();
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label="Nama pengguna">{(p) => <Input {...p} value={user.username} disabled />}</Field>
      <Field label="Nama" error={form.errors.name}>
        {(p) => <Input {...p} value={form.values.name} onChange={(e) => form.set("name", e.target.value)} />}
      </Field>
      <Field label="Peran" error={form.errors.role}>
        {(p) => <RoleSelect {...p} value={form.values.role} onChange={(role) => form.set("role", role)} />}
      </Field>
      <Field label="Kata sandi baru" hint="Kosongkan bila tidak diganti. Mengganti kata sandi mengeluarkan semua sesi." error={form.errors.password}>
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="new-password"
            value={form.values.password ?? ""}
            onChange={(e) => form.set("password", e.target.value)}
          />
        )}
      </Field>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={form.values.active} onChange={(e) => form.set("active", e.target.checked)} />
        Aktif (bisa masuk)
      </label>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={form.submitting}>
          Simpan perubahan
        </Button>
      </div>
    </form>
  );
}
