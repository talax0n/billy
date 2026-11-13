import { formatDate, formatRupiah, type opnameLineFilters, rupiah } from "@billy/core";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeft, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Dialog } from "../../components/ui/dialog.tsx";
import { Field, Input, Select } from "../../components/ui/field.tsx";
import { EmptyState, FilterRow, PageBody, PageHeader, StatTile } from "../../components/ui/page.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, ApiError, unwrap } from "../../lib/api.ts";
import { meQuery } from "../../lib/auth.ts";
import { cx } from "../../lib/cx.ts";

type Filter = (typeof opnameLineFilters)[number];
const filterLabels: Record<Filter, string> = { all: "Semua barang", counted: "Sudah dihitung", uncounted: "Belum dihitung", difference: "Ada selisih" };
const qty = new Intl.NumberFormat("id-ID");
const signed = (n: number) => (n > 0 ? `+${qty.format(n)}` : n < 0 ? `−${qty.format(-n)}` : "0");
const signedMoney = (value: number) => `${value > 0 ? "+" : ""}${formatRupiah(rupiah(value))}`;
const stamp = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });

/** Stok opname: the list, or one opname being counted (`/stok-opname?id=…`). */
export function OpnamePage() {
  const search: { id?: string } = useSearch({ strict: false });
  return search.id ? <OpnameDetail key={search.id} id={search.id} /> : <OpnameList />;
}

function OpnameList() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const paged = usePagedQuery(["opnames", "list"], (params) =>
    unwrap(api.opnames.$get({ query: { q: params.q, page: String(params.page), pageSize: String(params.pageSize) } })),
  );
  return (
    <>
      <PageHeader
        title="Stok Opname"
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Opname baru
          </Button>
        }
      />
      <PageBody>
        <DataTable
          paged={paged}
          searchPlaceholder="Cari nomor opname…"
          onRowClick={(row) => void navigate({ to: "/stok-opname", search: { id: row.id } })}
          empty={<EmptyState title="Belum ada stok opname" description="Hitung stok di rak dan bandingkan dengan stok sistem." />}
          columns={[
            { header: "Nomor", className: "whitespace-nowrap", cell: (r) => <span className="font-medium">{r.number}</span> },
            { header: "Cakupan", cell: (r) => r.categoryName ?? "Semua barang" },
            { header: "Tanggal", className: "whitespace-nowrap", cell: (r) => formatDate(r.date) },
            { header: "Dihitung", align: "right", cell: (r) => `${r.lineCount} barang` },
            { header: "Status", cell: (r) => (r.status === "posted" ? <Badge tone="up">Diposting</Badge> : <Badge tone="warn">Draf</Badge>) },
          ]}
        />
      </PageBody>
      <Dialog open={creating} onClose={() => setCreating(false)} title="Opname baru">
        {creating && <CreateForm onDone={() => setCreating(false)} />}
      </Dialog>
    </>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const categories = useQuery({ queryKey: ["categories", "all"], queryFn: () => unwrap(api.categories.$get({ query: { pageSize: "100" } })) });
  const [categoryId, setCategoryId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const opname = await unwrap(api.opnames.$post({ json: { categoryId: categoryId || null, note } }));
      onDone();
      void navigate({ to: "/stok-opname", search: { id: opname.id } });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      toast(err.message, "down");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label="Barang yang dihitung">
        {(p) => (
          <Select {...p} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Semua barang aktif</option>
            {categories.data?.rows.map((c) => (
              <option key={c.id} value={c.id}>
                Kategori {c.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Catatan" hint="Misal: rak depan, akhir bulan.">
        {(p) => <Input {...p} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={saving}>
          Mulai opname
        </Button>
      </div>
    </form>
  );
}

/**
 * One opname. On a draft every product in scope has an input; only the ones filled in count.
 * Edits stay on the screen until "Simpan hitungan", so several pages can be counted before saving.
 */
function OpnameDetail({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: me } = useSuspenseQuery(meQuery);
  const [filter, setFilter] = useState<Filter>("all");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const header = useQuery({ queryKey: ["opnames", id], queryFn: () => unwrap(api.opnames[":id"].$get({ param: { id } })) });
  const paged = usePagedQuery(
    ["opnames", id, "lines", filter],
    (params) =>
      unwrap(api.opnames[":id"].lines.$get({ param: { id }, query: { q: params.q, page: String(params.page), pageSize: String(params.pageSize), filter } })),
    50,
  );
  const opname = header.data;
  const draft = opname?.status === "draft";
  const dirty = Object.keys(edits).length;

  async function save() {
    const lines = Object.entries(edits).map(([productId, value]) => ({ productId, countedQty: value === "" ? null : Number(value) }));
    if (lines.length) await unwrap(api.opnames[":id"].lines.$put({ param: { id }, json: { lines } }));
    setEdits({});
    await queryClient.invalidateQueries({ queryKey: ["opnames"] });
  }

  async function run(action: () => Promise<void>) {
    setSaving(true);
    try {
      await action();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      toast(err.message, "down");
    } finally {
      setSaving(false);
    }
  }

  const post = () =>
    run(async () => {
      await save();
      const posted = await unwrap(api.opnames[":id"].post.$post({ param: { id } }));
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: ["opnames"] });
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      await queryClient.invalidateQueries({ queryKey: ["stock"] });
      toast(`Opname ${posted.number} diposting · ${posted.changed} barang disesuaikan`, "up");
    });

  return (
    <>
      <PageHeader
        title={opname ? `Opname ${opname.number}` : "Stok Opname"}
        actions={
          <>
            <Button variant="ghost" onClick={() => void navigate({ to: "/stok-opname", search: {} })}>
              <ArrowLeft className="size-4" />
              Semua opname
            </Button>
            {draft && (
              <Button
                disabled={saving || dirty === 0}
                onClick={() =>
                  void run(async () => {
                    await save();
                    toast("Hitungan disimpan", "up");
                  })
                }
              >
                Simpan hitungan{dirty ? ` (${dirty})` : ""}
              </Button>
            )}
            {draft && me?.role === "admin" && (
              <Button variant="primary" disabled={saving} onClick={() => setConfirming(true)}>
                Posting
              </Button>
            )}
          </>
        }
      />
      <PageBody>
        {opname && (
          <>
            <div className="grid grid-cols-3 gap-3 max-md:gap-2">
              <StatTile label="Dihitung" value={`${opname.counted} / ${opname.scope}`} note={opname.categoryName ? `Kategori ${opname.categoryName}` : "Semua barang aktif"} />
              <StatTile label="Selisih" value={`${opname.changed} barang`} />
              <StatTile
                label="Nilai selisih"
                value={signedMoney(opname.net)}
                tone={opname.net < 0 ? "down" : "neutral"}
                note="Dihitung dengan harga modal"
              />
            </div>
            <p className={cx("rounded-lg px-3 py-2", draft ? "bg-warn-bg/40 text-ink-2" : "bg-line-2 text-ink-2")}>
              {draft
                ? "Stok sistem diambil saat posting, bukan saat mulai. Penjualan selama penghitungan mengubahnya, jadi selisih di layar bisa berubah. Hanya barang yang diisi yang dihitung."
                : `Diposting oleh ${opname.postedByName ?? "admin"} pada ${stamp.format(new Date(opname.postedAt!))}. Opname ini tidak bisa diubah lagi.`}
            </p>
          </>
        )}
        <FilterRow aside={paged.query.data && `${paged.query.data.total} barang`}>
          <Select className="w-44" aria-label="Tampilkan" value={filter} onChange={(e) => {
              setFilter(e.target.value as Filter);
              paged.setPage(1);
            }}>
            {Object.entries(filterLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </FilterRow>
        <DataTable
          paged={paged}
          searchPlaceholder="Cari nama, kode atau barcode…"
          empty={<EmptyState title={filter === "all" ? "Tidak ada barang" : `Tidak ada barang: ${filterLabels[filter].toLowerCase()}`} />}
          columns={[
            {
              header: "Barang",
              cell: (r) => (
                <span>
                  {`${r.name} ${r.variant}`.trim()}
                  <small className="block font-normal text-muted">
                    {r.code ?? "Tanpa kode"} · {r.unit}
                  </small>
                </span>
              ),
            },
            { header: "Sistem", align: "right", cell: (r) => qty.format(r.systemQty) },
            {
              header: "Selisih",
              align: "right",
              cell: (r) => {
                const diff = difference(edits[r.id], r);
                return <span className={cx(diff !== null && diff < 0 && "text-down", diff !== null && diff > 0 && "text-warn")}>{diff === null ? "—" : signed(diff)}</span>;
              },
            },
            {
              header: "Nilai",
              align: "right",
              cell: (r) => {
                const diff = difference(edits[r.id], r);
                return diff === null ? "—" : signedMoney(diff * r.unitCost);
              },
            },
            {
              header: "Dihitung",
              align: "right",
              cell: (r) =>
                draft ? (
                  <Input
                    aria-label={`Jumlah dihitung ${r.name} ${r.variant}`.trim()}
                    inputMode="numeric"
                    enterKeyHint="done"
                    className={cx("ml-auto w-24 text-right tabular-nums", r.id in edits && "border-ink-2")}
                    placeholder="—"
                    value={edits[r.id] ?? (r.countedQty === null ? "" : String(r.countedQty))}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, "").slice(0, 9);
                      setEdits((current) => ({ ...current, [r.id]: value }));
                    }}
                  />
                ) : (
                  <span className="font-medium tabular-nums">{r.countedQty === null ? "—" : qty.format(r.countedQty)}</span>
                ),
            },
          ]}
        />
      </PageBody>
      <Dialog open={confirming} onClose={() => setConfirming(false)} title="Posting opname?">
        {confirming && opname && (
          <div className="flex flex-col gap-4">
            <p>
              Stok sistem diambil sekarang dan setiap selisih dicatat sebagai penyesuaian stok.
              {dirty > 0 && ` ${dirty} hitungan yang belum disimpan ikut disimpan.`} Setelah diposting, opname tidak bisa diubah.
            </p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setConfirming(false)}>Batal</Button>
              <Button variant="primary" disabled={saving} onClick={() => void post()}>
                Posting sekarang
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

/** Counted minus system for a line, using the unsaved edit when there is one. Null when not counted. */
function difference(edit: string | undefined, line: { systemQty: number; countedQty: number | null }): number | null {
  const counted = edit === undefined ? line.countedQty : edit === "" ? null : Number(edit);
  return counted === null ? null : counted - line.systemQty;
}
