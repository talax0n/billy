import type { Paginated } from "@billy/core";
import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cx } from "../../lib/cx.ts";
import { Button } from "./button.tsx";
import { SearchInput } from "./field.tsx";
import { EmptyState } from "./page.tsx";

export interface PageParams {
  q: string;
  page: number;
  pageSize: number;
}

/**
 * Server-side search + pagination state for a list endpoint returning `{ rows, total }`, plus
 * any summary fields the endpoint adds (typed through `Page`).
 * The query key is `[...key, params]`, so invalidating `key` refreshes every page.
 */
export function usePagedQuery<Page extends Paginated<unknown>>(
  key: readonly unknown[],
  fetchPage: (params: PageParams) => Promise<Page>,
  pageSize = 25,
) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const params = { q: debouncedQ, page, pageSize };
  const query = useQuery({
    queryKey: [...key, params],
    queryFn: () => fetchPage(params),
    placeholderData: keepPreviousData,
  });

  return {
    q,
    setQ: (value: string) => {
      setQ(value);
      setPage(1);
    },
    page,
    setPage,
    pageSize,
    query,
  };
}

export type PagedQuery<Page extends Paginated<unknown>> = Omit<ReturnType<typeof usePagedQuery<Page>>, "query"> & {
  query: UseQueryResult<Page>;
};

export interface Column<Row> {
  header: string;
  cell: (row: Row) => ReactNode;
  align?: "right";
  className?: string;
}

export function DataTable<Row extends { id: string }>({
  paged,
  columns,
  onRowClick,
  empty,
  search = true,
  searchPlaceholder,
  toolbar,
}: {
  paged: PagedQuery<Paginated<Row>>;
  columns: Column<Row>[];
  onRowClick?: (row: Row) => void;
  empty: ReactNode;
  search?: boolean;
  searchPlaceholder?: string;
  /** Extra controls on the right of the search box (filters). */
  toolbar?: ReactNode;
}) {
  const { data, isPending, isError, error } = paged.query;
  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : (paged.page - 1) * paged.pageSize + 1;
  const to = Math.min(paged.page * paged.pageSize, total);

  return (
    <div className="flex flex-col gap-3">
      {(search || toolbar) && (
        <div className="flex items-center gap-2">
          {search && <SearchInput value={paged.q} onChange={(e) => paged.setQ(e.target.value)} placeholder={searchPlaceholder} />}
          {toolbar}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-line">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-panel">
            <tr className="border-b border-line">
              {columns.map((col) => (
                <th
                  key={col.header}
                  className={cx(
                    "px-4 py-2.5 text-left text-xs font-normal text-muted",
                    col.align === "right" && "text-right",
                    col.className,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row) => (
              <tr
                key={row.id}
                onClick={onRowClick && (() => onRowClick(row))}
                className={cx("border-b border-line-2 last:border-b-0", onRowClick && "cursor-pointer hover:bg-line-2")}
              >
                {columns.map((col) => (
                  <td
                    key={col.header}
                    className={cx("px-4 py-2.5", col.align === "right" && "text-right tabular-nums", col.className)}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {isPending && <p className="px-4 py-10 text-center text-muted">Memuat…</p>}
        {isError && <p className="px-4 py-10 text-center text-down">{error.message}</p>}
        {data?.rows.length === 0 && (paged.q ? <EmptyState title="Tidak ada yang cocok" description={`Tidak ada hasil untuk “${paged.q}”.`} /> : empty)}
      </div>
      <div className="flex items-center justify-end gap-3 text-muted">
        <span className="tabular-nums">
          {from}–{to} dari {total}
        </span>
        <Button size="icon" aria-label="Halaman sebelumnya" disabled={paged.page <= 1} onClick={() => paged.setPage(paged.page - 1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <Button size="icon" aria-label="Halaman berikutnya" disabled={to >= total} onClick={() => paged.setPage(paged.page + 1)}>
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
