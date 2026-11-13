import { type ContactKind, contactKindLabels, contactKinds } from "@billy/core";
import type { InferResponseType } from "hono/client";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Select } from "../../components/ui/field.tsx";
import { EmptyState, PageBody, PageHeader } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { ContactSheet } from "./contact-sheet.tsx";

export type ContactRow = InferResponseType<typeof api.contacts.$get, 200>["rows"][number];

export function ContactsPage() {
  const [kind, setKind] = useState<ContactKind | "">("");
  const paged = usePagedQuery(["contacts", { kind }], (params) =>
    unwrap(
      api.contacts.$get({
        query: { q: params.q, page: String(params.page), pageSize: String(params.pageSize), ...(kind && { kind }) },
      }),
    ),
  );
  /** null: closed; "new": create form; a string: the contact being edited. */
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Kontak"
        actions={
          <Button variant="primary" onClick={() => setOpen("new")}>
            <Plus className="size-4" />
            Kontak baru
          </Button>
        }
      />
      <PageBody>
        <DataTable
          paged={paged}
          searchPlaceholder="Cari nama, kode, telepon…"
          toolbar={
            <Select
              aria-label="Jenis kontak"
              className="w-44"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as ContactKind | "");
                paged.setPage(1);
              }}
            >
              <option value="">Semua jenis</option>
              {contactKinds.map((k) => (
                <option key={k} value={k}>
                  {contactKindLabels[k]}
                </option>
              ))}
            </Select>
          }
          onRowClick={(row) => setOpen(row.id)}
          empty={<EmptyState title="Belum ada kontak" action={<Button onClick={() => setOpen("new")}>Tambah kontak</Button>} />}
          columns={[
            { header: "Kode", cell: (c) => <span className="text-muted">{c.code}</span>, className: "w-32" },
            {
              header: "Nama",
              cell: (c) => (
                <span className="flex items-center gap-2">
                  {c.name}
                  {!c.active && <Badge>Nonaktif</Badge>}
                </span>
              ),
            },
            { header: "Jenis", cell: (c) => <span className="text-ink-2">{contactKindLabels[c.kind]}</span> },
            { header: "Telepon", cell: (c) => <span className="text-ink-2">{c.phone || "—"}</span> },
            {
              header: "Tempo",
              align: "right",
              cell: (c) => (c.paymentTermsDays ? `${c.paymentTermsDays} hari` : <span className="text-muted">Tunai</span>),
            },
          ]}
        />
      </PageBody>
      {open && <ContactSheet contactId={open === "new" ? null : open} defaultKind={kind || "customer"} onClose={() => setOpen(null)} />}
    </>
  );
}
