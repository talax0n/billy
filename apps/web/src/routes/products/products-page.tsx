import { formatRupiah } from "@billy/core";
import type { InferResponseType } from "hono/client";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { EmptyState, PageBody, PageHeader } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { ProductSheet } from "./product-sheet.tsx";
import { StockQty } from "./stock-qty.tsx";

export type ProductRow = InferResponseType<typeof api.products.$get, 200>["rows"][number];

export function ProductsPage() {
  const paged = usePagedQuery(["products"], (params) =>
    unwrap(api.products.$get({ query: { q: params.q, page: String(params.page), pageSize: String(params.pageSize) } })),
  );
  /** null: closed; "new": create form; a string: the product being edited. */
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Produk"
        actions={
          <Button variant="primary" onClick={() => setOpen("new")}>
            <Plus className="size-4" />
            Produk baru
          </Button>
        }
      />
      <PageBody>
        <DataTable
          paged={paged}
          searchPlaceholder="Cari nama, varian, kode, barcode…"
          onRowClick={(row) => setOpen(row.id)}
          empty={<EmptyState title="Belum ada produk" action={<Button onClick={() => setOpen("new")}>Tambah produk</Button>} />}
          columns={[
            { header: "Kode", cell: (p) => <span className="text-muted">{p.code ?? "—"}</span>, className: "w-28" },
            {
              header: "Nama",
              cell: (p) => (
                <span className="flex items-center gap-2">
                  {p.name}
                  {p.variant && <span className="text-muted">{p.variant}</span>}
                  {!p.active && <Badge>Nonaktif</Badge>}
                </span>
              ),
            },
            { header: "Kategori", cell: (p) => <span className="text-ink-2">{p.categoryName ?? "—"}</span> },
            { header: "Harga jual (Rp)", align: "right", cell: (p) => formatRupiah(p.sellPrice, { symbol: false }) },
            { header: "Stok", align: "right", cell: (p) => <StockQty product={p} /> },
          ]}
        />
      </PageBody>
      {open && <ProductSheet productId={open === "new" ? null : open} onOpenProduct={setOpen} onClose={() => setOpen(null)} />}
    </>
  );
}
