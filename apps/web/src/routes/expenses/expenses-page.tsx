import { businessDate, formatDate, formatRupiah, rupiah } from "@billy/core";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Input } from "../../components/ui/field.tsx";
import { EmptyState, PageBody, PageHeader, StatTile } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { ExpenseSheet } from "./expense-sheet.tsx";


const monthLabel = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });

export function ExpensesPage() {
  /** `YYYY-MM`, or "" for every period. */
  const [month, setMonth] = useState(businessDate().slice(0, 7));
  const paged = usePagedQuery(["expenses", { month }], (params) =>
    unwrap(
      api.expenses.$get({
        query: { q: params.q, page: String(params.page), pageSize: String(params.pageSize), ...(month && { month }) },
      }),
    ),
  );
  const amountTotal = paged.query.data?.amountTotal;
  /** The open expense lives in the URL (`/biaya?id=…`) so other pages can link to it. */
  const search: { id?: string } = useSearch({ strict: false });
  const navigate = useNavigate();
  const openExpense = (id: string | null) => void navigate({ to: "/biaya", search: id ? { id } : {} });
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Biaya"
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Catat biaya
          </Button>
        }
      />
      <PageBody>
        <div className="grid grid-cols-3 gap-3.5 max-md:grid-cols-2 max-md:gap-2 max-md:[&>:last-child:nth-child(odd)]:col-span-2">
          <StatTile
            label={month ? `Total biaya ${monthLabel.format(new Date(`${month}-01T00:00:00Z`))}` : "Total biaya semua periode"}
            value={amountTotal === undefined ? "—" : formatRupiah(rupiah(amountTotal))}
            note={paged.query.data && `${paged.query.data.total} catatan · biaya yang di-void tidak dihitung`}
          />
        </div>
        <DataTable
          paged={paged}
          searchPlaceholder="Cari nomor, kategori, keterangan…"
          toolbar={
            <Input
              type="month"
              aria-label="Bulan"
              className="w-44"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                paged.setPage(1);
              }}
            />
          }
          onRowClick={(row) => openExpense(row.id)}
          empty={<EmptyState title="Belum ada biaya di periode ini" action={<Button onClick={() => setCreating(true)}>Catat biaya</Button>} />}
          columns={[
            { header: "Tanggal", cell: (e) => formatDate(e.date), className: "whitespace-nowrap" },
            { header: "Nomor", cell: (e) => <span className="text-muted">{e.number}</span>, className: "whitespace-nowrap" },
            { header: "Kategori", cell: (e) => e.category },
            { header: "Keterangan", cell: (e) => <span className="text-ink-2">{e.description || "—"}</span> },
            { header: "Akun", cell: (e) => <span className="text-ink-2">{e.accountName}</span> },
            {
              header: "Jumlah",
              align: "right",
              cell: (e) => <span className={e.voidedAt ? "text-muted line-through" : undefined}>{formatRupiah(e.amount)}</span>,
            },
            { header: "Status", className: "w-20", cell: (e) => e.voidedAt && <Badge>Void</Badge> },
          ]}
        />
      </PageBody>
      {creating && <ExpenseSheet expenseId={null} onClose={() => setCreating(false)} />}
      {search.id && <ExpenseSheet expenseId={search.id} onClose={() => openExpense(null)} />}
    </>
  );
}
