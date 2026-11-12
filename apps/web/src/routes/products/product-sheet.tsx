import { formatDate, formatRupiah, type ProductInput, productInput } from "@billy/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Sheet } from "../../components/ui/dialog.tsx";
import { Field, Input, MoneyInput, Select } from "../../components/ui/field.tsx";
import { EmptyState, StatTile } from "../../components/ui/page.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { useForm } from "../../lib/form.ts";
import type { ProductRow } from "./products-page.tsx";
import { StockAdjustDialog } from "./stock-adjust-dialog.tsx";
import { StockQty } from "./stock-qty.tsx";

const emptyProduct: ProductInput = {
  code: "",
  barcode: "",
  name: "",
  variant: "",
  unit: "pcs",
  categoryId: null,
  sellPrice: 0,
  costPrice: 0,
  minStock: 0,
  active: true,
};

/** Create (`productId` null) or edit a product, adjust its stock and read its movements. */
export function ProductSheet({
  productId,
  onOpenProduct,
  onClose,
}: {
  productId: string | null;
  onOpenProduct: (id: string) => void;
  onClose: () => void;
}) {
  const product = useQuery({
    queryKey: ["products", productId],
    queryFn: () => unwrap(api.products[":id"].$get({ param: { id: productId! } })),
    enabled: productId !== null,
  });

  return (
    <Sheet
      open
      onClose={onClose}
      title={productId ? (product.data ? `${product.data.name} ${product.data.variant}` : "Memuat…") : "Produk baru"}
      description={product.data?.code ?? undefined}
    >
      {productId === null ? (
        <ProductForm initial={emptyProduct} onSaved={(saved) => onOpenProduct(saved.id)} />
      ) : (
        product.data && <ProductDetail key={product.data.id} product={product.data} />
      )}
    </Sheet>
  );
}

function ProductDetail({ product }: { product: ProductRow }) {
  const [adjusting, setAdjusting] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Stok" value={<StockQty product={product} />} note={`Minimum ${product.minStock} ${product.unit}`} />
        <StatTile label="Harga jual" value={<small className="text-lg">{formatRupiah(product.sellPrice)}</small>} />
        <StatTile label="Harga pokok" value={<small className="text-lg">{formatRupiah(product.costPrice)}</small>} />
      </div>
      <ProductForm id={product.id} initial={{ ...product }} />
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Mutasi stok</h3>
          <Button size="sm" onClick={() => setAdjusting(true)}>
            <SlidersHorizontal className="size-3.5" />
            Sesuaikan stok
          </Button>
        </div>
        <MovementHistory productId={product.id} />
      </section>
      <StockAdjustDialog product={product} open={adjusting} onClose={() => setAdjusting(false)} />
    </div>
  );
}

function ProductForm({ id, initial, onSaved }: { id?: string; initial: ProductInput; onSaved?: (p: ProductRow) => void }) {
  const queryClient = useQueryClient();
  const form = useForm(productInput, initial);
  const categories = useQuery({
    queryKey: ["categories", "all"],
    queryFn: () => unwrap(api.categories.$get({ query: { pageSize: "100" } })),
  });

  const submit = form.onSubmit(async (input) => {
    const saved = id
      ? await unwrap(api.products[":id"].$put({ param: { id }, json: input }))
      : await unwrap(api.products.$post({ json: input }));
    await queryClient.invalidateQueries({ queryKey: ["products"] });
    toast("Produk disimpan", "up");
    onSaved?.(saved);
  });

  const v = form.values;
  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-2 gap-x-3 gap-y-4">
      <Field label="Nama" error={form.errors.name} className="col-span-2">
        {(p) => <Input {...p} autoFocus={!id} value={v.name} onChange={(e) => form.set("name", e.target.value)} />}
      </Field>
      <Field label="Varian" hint="Warna, ukuran, kemasan" error={form.errors.variant}>
        {(p) => <Input {...p} value={v.variant ?? ""} onChange={(e) => form.set("variant", e.target.value)} />}
      </Field>
      <Field label="Satuan" error={form.errors.unit}>
        {(p) => <Input {...p} value={v.unit} onChange={(e) => form.set("unit", e.target.value)} />}
      </Field>
      <Field label="Kode" error={form.errors.code}>
        {(p) => <Input {...p} value={v.code ?? ""} onChange={(e) => form.set("code", e.target.value)} />}
      </Field>
      <Field label="Barcode" error={form.errors.barcode}>
        {(p) => <Input {...p} value={v.barcode ?? ""} onChange={(e) => form.set("barcode", e.target.value)} />}
      </Field>
      <Field label="Kategori" error={form.errors.categoryId} className="col-span-2">
        {(p) => (
          <Select {...p} value={v.categoryId ?? ""} onChange={(e) => form.set("categoryId", e.target.value || null)}>
            <option value="">Tanpa kategori</option>
            {categories.data?.rows.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Harga jual" error={form.errors.sellPrice}>
        {(p) => <MoneyInput {...p} value={v.sellPrice} onChange={(value) => form.set("sellPrice", value)} />}
      </Field>
      <Field label="Harga pokok" hint="Diperbarui otomatis dari pembelian" error={form.errors.costPrice}>
        {(p) => <MoneyInput {...p} value={v.costPrice} onChange={(value) => form.set("costPrice", value)} />}
      </Field>
      <Field label="Stok minimum" error={form.errors.minStock}>
        {(p) => (
          <Input
            {...p}
            type="number"
            min={0}
            value={v.minStock}
            onChange={(e) => form.set("minStock", Number(e.target.value))}
          />
        )}
      </Field>
      <label className="flex items-center gap-2 self-end pb-2">
        <input type="checkbox" checked={v.active ?? true} onChange={(e) => form.set("active", e.target.checked)} />
        Aktif dijual
      </label>
      <div className="col-span-2 flex justify-end">
        <Button type="submit" variant="primary" disabled={form.submitting}>
          {id ? "Simpan perubahan" : "Simpan produk"}
        </Button>
      </div>
    </form>
  );
}

const reasonLabels = {
  purchase: "Pembelian",
  sale: "Penjualan",
  pos: "Kasir",
  adjustment: "Penyesuaian",
  reversal: "Pembatalan",
} as const;

function MovementHistory({ productId }: { productId: string }) {
  const paged = usePagedQuery(
    ["products", productId, "movements"],
    (params) =>
      unwrap(
        api.products[":id"].movements.$get({
          param: { id: productId },
          query: { page: String(params.page), pageSize: String(params.pageSize) },
        }),
      ),
    10,
  );
  return (
    <DataTable
      paged={paged}
      search={false}
      empty={<EmptyState title="Belum ada mutasi" />}
      columns={[
        { header: "Tanggal", cell: (m) => formatDate(m.date), className: "whitespace-nowrap" },
        { header: "Jenis", cell: (m) => reasonLabels[m.reason] },
        {
          header: "Jumlah",
          align: "right",
          cell: (m) => <span className={m.qty < 0 ? "text-down" : "text-up"}>{m.qty > 0 ? `+${m.qty}` : m.qty}</span>,
        },
        { header: "Catatan", cell: (m) => <span className="text-ink-2">{m.note}</span> },
        { header: "Oleh", cell: (m) => <span className="text-muted">{m.createdByName}</span> },
      ]}
    />
  );
}
