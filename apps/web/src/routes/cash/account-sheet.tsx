import {
  type AccountInput,
  accountInput,
  accountKindLabels,
  accountKinds,
  cashCategories,
  cashCategoryLabels,
  formatDate,
  formatRupiah,
  rupiah,
} from "@billy/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { Sheet } from "../../components/ui/dialog.tsx";
import { DateInput, Field, Input, Select } from "../../components/ui/field.tsx";
import { EmptyState, FilterRow, StatTile } from "../../components/ui/page.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";
import { useForm } from "../../lib/form.ts";
import { type CashAction, CashDialog } from "./cash-dialogs.tsx";
import type { AccountRow } from "./cash-page.tsx";
import { VoidDialog } from "./void-dialog.tsx";

/** A balance, red when the account is overdrawn. */
export function Balance({ value }: { value: number }) {
  return <span className={cx("tabular-nums", value < 0 && "text-down")}>{formatRupiah(rupiah(value))}</span>;
}

type CashBookPage = InferResponseType<(typeof api.accounts)[":id"]["entries"]["$get"], 200>;
type CashBookRow = CashBookPage["rows"][number];

/** Create (`accountId` null) or open an account: its balance, cash book and master data. */
export function AccountSheet({
  accountId,
  onOpenAccount,
  onClose,
}: {
  accountId: string | null;
  onOpenAccount: (id: string) => void;
  onClose: () => void;
}) {
  const account = useQuery({
    queryKey: ["accounts", accountId],
    queryFn: () => unwrap(api.accounts[":id"].$get({ param: { id: accountId! } })),
    enabled: accountId !== null,
  });

  return (
    <Sheet
      open
      onClose={onClose}
      className="max-w-3xl!"
      title={accountId ? (account.data?.name ?? "Memuat…") : "Akun baru"}
      description={account.data && `${account.data.code} · ${accountKindLabels[account.data.kind]}`}
    >
      {accountId === null ? (
        <AccountForm initial={{ code: "", name: "", kind: "bank", active: true }} onSaved={(saved) => onOpenAccount(saved.id)} />
      ) : (
        account.data && <AccountDetail key={account.data.id} account={account.data} />
      )}
    </Sheet>
  );
}

function AccountDetail({ account }: { account: AccountRow }) {
  const [action, setAction] = useState<CashAction | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-3">
        <StatTile label="Saldo" value={<Balance value={account.balance} />} />
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setAction("in")}>
            <ArrowDownLeft className="size-3.5" />
            Uang masuk
          </Button>
          <Button size="sm" onClick={() => setAction("out")}>
            <ArrowUpRight className="size-3.5" />
            Uang keluar
          </Button>
          <Button size="sm" onClick={() => setAction("transfer")}>
            <ArrowLeftRight className="size-3.5" />
            Transfer
          </Button>
        </div>
      </div>
      <CashBook accountId={account.id} />
      <section className="flex flex-col gap-3 border-t border-line pt-5">
        <h3 className="font-medium">Data akun</h3>
        <AccountForm id={account.id} initial={account} />
      </section>
      <CashDialog action={action} accountId={account.id} onClose={() => setAction(null)} />
    </div>
  );
}

interface CashBookFilters {
  from: string;
  to: string;
  direction: "" | "in" | "out";
  category: "" | (typeof cashCategories)[number];
}

function CashBook({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<CashBookFilters>({ from: "", to: "", direction: "", category: "" });
  const paged = usePagedQuery(["accounts", accountId, "entries", filters], (params) => {
    const { from, to, direction, category } = filters;
    return unwrap(
      api.accounts[":id"].entries.$get({
        param: { id: accountId },
        query: {
          q: params.q,
          page: String(params.page),
          pageSize: String(params.pageSize),
          ...(from && { from }),
          ...(to && { to }),
          ...(direction && { direction }),
          ...(category && { category }),
        },
      }),
    );
  }, 15);
  const setFilter = <K extends keyof CashBookFilters>(key: K, value: CashBookFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    paged.setPage(1);
  };

  const [voiding, setVoiding] = useState<CashBookRow | null>(null);
  const voidSource = useMutation({
    mutationFn: ({ row, reason }: { row: CashBookRow; reason: string }): Promise<unknown> =>
      row.sourceType === "transfer"
        ? unwrap(api.cash.transfers[":id"].void.$post({ param: { id: row.sourceId! }, json: { reason } }))
        : unwrap(api.expenses[":id"].void.$post({ param: { id: row.sourceId! }, json: { reason } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["expenses"] });
      toast("Dokumen di-void, saldo dikembalikan", "up");
    },
  });

  // usePagedQuery types the page as `{ rows, total }`; the response also carries the period totals.
  const data = paged.query.data as CashBookPage | undefined;
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-medium">Buku kas</h3>
      <FilterRow
        aside={
          data && (
            <span className="tabular-nums">
              Masuk <span className="text-up">{formatRupiah(rupiah(data.totalIn))}</span> · Keluar{" "}
              <span className="text-down">{formatRupiah(rupiah(data.totalOut))}</span>
            </span>
          )
        }
      >
        <DateInput aria-label="Dari tanggal" className="w-36!" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} />
        <span className="text-muted">s/d</span>
        <DateInput aria-label="Sampai tanggal" className="w-36!" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} />
        <Select
          aria-label="Arah"
          className="w-28!"
          value={filters.direction}
          onChange={(e) => setFilter("direction", e.target.value as CashBookFilters["direction"])}
        >
          <option value="">Semua</option>
          <option value="in">Masuk</option>
          <option value="out">Keluar</option>
        </Select>
        <Select
          aria-label="Kategori"
          className="w-40!"
          value={filters.category}
          onChange={(e) => setFilter("category", e.target.value as CashBookFilters["category"])}
        >
          <option value="">Semua kategori</option>
          {cashCategories.map((category) => (
            <option key={category} value={category}>
              {cashCategoryLabels[category]}
            </option>
          ))}
        </Select>
      </FilterRow>
      <DataTable
        paged={paged}
        searchPlaceholder="Cari keterangan…"
        empty={<EmptyState title="Belum ada mutasi" description="Mutasi muncul dari penjualan, pembelian, biaya, transfer, dan uang masuk/keluar lain." />}
        columns={[
          { header: "Tanggal", cell: (e) => formatDate(e.date), className: "whitespace-nowrap" },
          {
            header: "Keterangan",
            cell: (e) => (
              <span className="flex flex-col">
                <span>
                  {cashCategoryLabels[e.category]}
                  {e.expenseNumber && <span className="whitespace-nowrap text-muted"> · {e.expenseNumber}</span>}
                </span>
                {e.note && <span className="text-xs text-muted">{e.note}</span>}
              </span>
            ),
          },
          { header: "Masuk", align: "right", className: "whitespace-nowrap", cell: (e) => (e.direction === "in" ? <span className="text-up">{formatRupiah(e.amount)}</span> : "") },
          { header: "Keluar", align: "right", className: "whitespace-nowrap", cell: (e) => (e.direction === "out" ? <span className="text-down">{formatRupiah(e.amount)}</span> : "") },
          { header: "Saldo", align: "right", className: "whitespace-nowrap", cell: (e) => <Balance value={e.balance} /> },
          {
            header: "",
            className: "w-14",
            cell: (e) =>
              e.voidable && (
                <Button size="sm" variant="ghost" onClick={() => setVoiding(e)}>
                  Void
                </Button>
              ),
          },
        ]}
      />
      <VoidDialog
        open={voiding !== null}
        title={voiding?.sourceType === "transfer" ? "Void transfer" : "Void biaya"}
        description={voiding && `${formatDate(voiding.date)} · ${formatRupiah(voiding.amount)}`}
        onVoid={(reason) => voidSource.mutateAsync({ row: voiding!, reason })}
        onClose={() => setVoiding(null)}
      />
    </section>
  );
}

function AccountForm({ id, initial, onSaved }: { id?: string; initial: AccountInput; onSaved?: (account: AccountRow) => void }) {
  const queryClient = useQueryClient();
  const form = useForm(accountInput, initial);
  const submit = form.onSubmit(async (json) => {
    const saved = id
      ? await unwrap(api.accounts[":id"].$put({ param: { id }, json }))
      : await unwrap(api.accounts.$post({ json }));
    await queryClient.invalidateQueries({ queryKey: ["accounts"] });
    toast("Akun disimpan", "up");
    onSaved?.(saved);
  });
  const v = form.values;
  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-2 gap-x-3 gap-y-4">
      <Field label="Nama akun" error={form.errors.name} className="col-span-2">
        {(p) => <Input {...p} autoFocus={!id} value={v.name} onChange={(e) => form.set("name", e.target.value)} />}
      </Field>
      <Field label="Kode" error={form.errors.code}>
        {(p) => <Input {...p} value={v.code} onChange={(e) => form.set("code", e.target.value)} />}
      </Field>
      <Field label="Jenis" error={form.errors.kind}>
        {(p) => (
          <Select {...p} value={v.kind} onChange={(e) => form.set("kind", e.target.value as AccountInput["kind"])}>
            {accountKinds.map((kind) => (
              <option key={kind} value={kind}>
                {accountKindLabels[kind]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <label className="col-span-2 flex items-center gap-2">
        <input type="checkbox" checked={v.active ?? true} onChange={(e) => form.set("active", e.target.checked)} />
        Aktif (muncul di pilihan akun). Akun tidak bisa dihapus agar riwayat kasnya tetap ada.
      </label>
      <div className="col-span-2 flex justify-end">
        <Button type="submit" variant="primary" disabled={form.submitting}>
          {id ? "Simpan perubahan" : "Simpan akun"}
        </Button>
      </div>
    </form>
  );
}
