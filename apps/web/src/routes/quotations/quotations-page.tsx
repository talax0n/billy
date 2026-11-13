import { formatDate, formatRupiah, type QuotationStatus, quotationStatusLabels, quotationStatuses, rupiah } from "@billy/core";
import { Plus } from "lucide-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Select } from "../../components/ui/field.tsx";
import { EmptyState, FilterRow, PageBody, PageHeader } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { QuotationSheet, QuotationStatusTag } from "./quotation-sheet.tsx";

const filters: QuotationStatus[] = [...quotationStatuses, "expired"];

/** Penawaran harga. The open quote lives in the URL (`/penawaran?id=…`) so a faktur can link back to it. */
export function QuotationsPage() {
  const search: { id?: string } = useSearch({ strict: false });
  const navigate = useNavigate();
  const openQuotation = (id: string | null) => void navigate({ to: "/penawaran", search: id ? { id } : {} });
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<QuotationStatus | "">("");
  const paged = usePagedQuery(["quotations", "list", status], (params) =>
    unwrap(
      api.quotations.$get({
        query: { q: params.q, page: String(params.page), pageSize: String(params.pageSize), ...(status && { status }) },
      }),
    ),
  );

  return (
    <>
      <PageHeader
        title="Penawaran"
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Penawaran baru
          </Button>
        }
      />
      <PageBody>
        <FilterRow aside={paged.query.data && `${paged.query.data.total} penawaran`}>
          <Select className="w-40" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as QuotationStatus | "")}>
            <option value="">Semua status</option>
            {filters.map((s) => (
              <option key={s} value={s}>
                {quotationStatusLabels[s]}
              </option>
            ))}
          </Select>
        </FilterRow>
        <DataTable
          paged={paged}
          searchPlaceholder="Cari nomor penawaran atau pelanggan…"
          onRowClick={(row) => openQuotation(row.id)}
          empty={<EmptyState title="Belum ada penawaran" action={<Button onClick={() => setCreating(true)}>Buat penawaran</Button>} />}
          columns={[
            { header: "Nomor", cell: (r) => <span className="font-medium">{r.number}</span>, className: "whitespace-nowrap" },
            { header: "Pelanggan", cell: (r) => r.customerName },
            { header: "Tanggal", cell: (r) => formatDate(r.date), className: "whitespace-nowrap" },
            { header: "Berlaku sampai", cell: (r) => formatDate(r.validUntil), className: "whitespace-nowrap" },
            { header: "Total", align: "right", cell: (r) => formatRupiah(rupiah(r.total)) },
            { header: "Status", cell: (r) => <QuotationStatusTag status={r.status} /> },
          ]}
        />
      </PageBody>
      {creating && (
        <QuotationSheet
          quotationId={null}
          onOpenQuotation={(id) => {
            setCreating(false);
            openQuotation(id);
          }}
          onClose={() => setCreating(false)}
        />
      )}
      {search.id && <QuotationSheet quotationId={search.id} onOpenQuotation={openQuotation} onClose={() => openQuotation(null)} />}
    </>
  );
}
