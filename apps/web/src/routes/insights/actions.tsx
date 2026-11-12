import {
  actionRegistry,
  businessDate,
  CASH_DEPOSIT_THRESHOLD,
  formatDate,
  formatRupiah,
  type ActionItem,
} from "@billy/core";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BellDot, type LucideIcon } from "lucide-react";
import { forwardRef } from "react";
import { Badge, StatusTag } from "../../components/ui/badge.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { EmptyState, PageBody, PageHeader } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import "./insights.css";

export const actionsOptions = queryOptions({
  queryKey: ["insights", "action-count"],
  queryFn: () =>
    unwrap(api.insights.actions.$get({ query: { pageSize: "1" } })),
  refetchInterval: 60000,
});
export const ActionNavIcon: LucideIcon = forwardRef(
  function ActionNavIcon(props, ref) {
    const { data } = useQuery(actionsOptions);
    return (
      <>
        <BellDot {...props} ref={ref} />
        {data && (
          <span
            className="insight-nav-count"
            aria-label={`${data.count} tindakan`}
          >
            {data.count}
          </span>
        )}
      </>
    );
  },
);
export function ActionStatus({ item }: { item: ActionItem }) {
  if (item.kind === "receivable" || item.kind === "payable")
    return (
      <StatusTag
        state={{
          status: item.kind === "payable" ? item.status : "unpaid",
          overdue: item.dueDate < businessDate(),
        }}
      />
    );
  return (
    <Badge tone={item.kind === "negative-stock" ? "down" : "warn"}>
      {item.kind === "deposit"
        ? "Perlu setor"
        : item.kind === "negative-stock"
          ? "Stok negatif"
          : "Stok rendah"}
    </Badge>
  );
}
export function actionDescription(item: ActionItem) {
  switch (item.kind) {
    case "receivable":
      return `${item.count} faktur · ${formatRupiah(item.amount)} · Jatuh tempo tertua ${formatDate(item.dueDate)}`;
    case "payable":
      return `${formatRupiah(item.amount)} · Jatuh tempo ${formatDate(item.dueDate)}`;
    case "deposit":
      return `${formatRupiah(item.amount)} · Saldo kas di atas batas setor ${formatRupiah(CASH_DEPOSIT_THRESHOLD)}`;
    default:
      return `Stok ${item.stock} · Minimum ${item.minStock}`;
  }
}
export function ActionLink({ item }: { item: ActionItem }) {
  return (
    <Link className="insight-button" to={actionRegistry[item.kind].target}>
      {actionRegistry[item.kind].title} →
    </Link>
  );
}
export function ActionsPage() {
  const paged = usePagedQuery(["insights", "actions"], (params) =>
    unwrap(
      api.insights.actions.$get({
        query: {
          q: params.q,
          page: String(params.page),
          pageSize: String(params.pageSize),
        },
      }),
    ),
  );
  return (
    <>
      <PageHeader
        title="Perlu Tindakan"
        description="Urutan prioritas: stok negatif, piutang telat, hutang, stok rendah, lalu setoran kas."
      />
      <PageBody>
        <DataTable
          paged={paged}
          searchPlaceholder="Cari pelanggan, pemasok, produk, akun…"
          empty={
            <EmptyState
              title="Semua sudah beres"
              description="Tidak ada tindakan yang perlu diselesaikan saat ini."
            />
          }
          columns={[
            { header: "Prioritas", cell: (r) => <ActionStatus item={r} /> },
            {
              header: "Tindakan",
              cell: (r) => (
                <>
                  <div className="font-medium">{r.name}</div>
                  <div className="mt-1 text-xs text-muted">
                    {actionDescription(r)}
                  </div>
                </>
              ),
            },
            {
              header: "Selesaikan",
              align: "right",
              cell: (r) => <ActionLink item={r} />,
            },
          ]}
        />
      </PageBody>
    </>
  );
}
