import type { Paginated, SortDir } from "@billy/core";
import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cx } from "../../lib/cx.ts";
import { Button } from "./button.tsx";
import { SearchInput } from "./field.tsx";
import { EmptyState, Loading } from "./page.tsx";

export interface Sort<Key extends string = string> {
  key: Key;
  dir: SortDir;
}

/** `{ sort, dir }` for a list endpoint's query string; empty when the list has no sort. */
export const sortParams = <Key extends string>(sort: Sort<Key> | undefined) => (sort ? { sort: sort.key, dir: sort.dir } : {});

export interface PageParams<Key extends string = string> {
  q: string;
  page: number;
  pageSize: number;
  /** Set only when the caller passed a default sort; send it as `?sort=&dir=`. */
  sort?: Sort<Key>;
}

/**
 * Server-side search + pagination state for a list endpoint returning `{ rows, total }`, plus
 * any summary fields the endpoint adds (typed through `Page`).
 * The query key is `[...key, params]`, so invalidating `key` refreshes every page.
 */
export function usePagedQuery<Page extends Paginated<unknown>, Key extends string = never>(
  key: readonly unknown[],
  fetchPage: (params: PageParams<Key>) => Promise<Page>,
  { pageSize = 25, sort: defaultSort }: { pageSize?: number; sort?: Sort<Key> } = {},
) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState(defaultSort);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const params: PageParams<Key> = { q: debouncedQ, page, pageSize, ...(sort && { sort }) };
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
    sort: sort as Sort | undefined,
    /** The same column flips direction; a new column starts ascending. */
    sortBy: (column: string) => {
      setSort((current) => ({ key: column as Key, dir: current?.key === column && current.dir === "asc" ? "desc" : "asc" }));
      setPage(1);
    },
    query,
  };
}

export type PagedQuery<Page extends Paginated<unknown>> = Omit<ReturnType<typeof usePagedQuery<Page, string>>, "query"> & {
  query: UseQueryResult<Page>;
};

export interface Column<Row> {
  header: string;
  cell: (row: Row) => ReactNode;
  align?: "right";
  className?: string;
  /** Phone card list: false leaves the column out of the card. */
  mobile?: boolean;
  /** The list endpoint's sort key for this column; makes the header a sort button. */
  sort?: string;
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
        <div className="flex items-center gap-2 max-md:flex-wrap">
          {search && <SearchInput value={paged.q} onChange={(e) => paged.setQ(e.target.value)} placeholder={searchPlaceholder} />}
          {toolbar}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-line">
        {data && <MobileCards rows={data.rows} columns={columns} onRowClick={onRowClick} />}
        <table className="w-full min-w-[520px] border-collapse max-md:hidden">
          <thead className="sticky top-0 bg-panel">
            <tr className="border-b border-line">
              {columns.map((col) => (
                <th
                  key={col.header}
                  aria-sort={col.sort && paged.sort?.key === col.sort ? (paged.sort.dir === "asc" ? "ascending" : "descending") : undefined}
                  className={cx(
                    "px-4 py-2.5 text-left text-xs font-normal text-muted",
                    col.align === "right" && "text-right",
                    col.className,
                  )}
                >
                  {col.sort ? <SortButton column={col} sortKey={col.sort} paged={paged} /> : col.header}
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
        {isPending && <Loading />}
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

function SortButton<Row>({ column, sortKey, paged }: { column: Column<Row>; sortKey: string; paged: PagedQuery<Paginated<Row>> }) {
  const dir = paged.sort?.key === sortKey ? paged.sort.dir : undefined;
  const Icon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <button
      type="button"
      onClick={() => paged.sortBy(sortKey)}
      className={cx(
        "-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-ink",
        column.align === "right" && "flex-row-reverse",
        dir && "text-ink",
      )}
    >
      {column.header}
      <Icon className={cx("size-3", !dir && "opacity-40")} aria-hidden />
    </button>
  );
}

/**
 * Below `md` each row is a card: the first column is the title, the last sits beside it
 * (usually a status or amount), and the columns between are label/value lines.
 */
function MobileCards<Row extends { id: string }>({
  rows,
  columns,
  onRowClick,
}: {
  rows: Row[];
  columns: Column<Row>[];
  onRowClick?: ((row: Row) => void) | undefined;
}) {
  const shown = columns.filter((col) => col.mobile !== false);
  const [first, ...rest] = shown;
  const last = rest.length > 1 ? rest.pop() : undefined;
  if (!first) return null;
  return (
    <ul className="md:hidden">
      {rows.map((row) => (
        <li
          key={row.id}
          onClick={onRowClick && (() => onRowClick(row))}
          className={cx("border-b border-line-2 px-4 py-3 last:border-b-0", onRowClick && "cursor-pointer active:bg-line-2")}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 font-medium">{first.cell(row)}</div>
            {last && <div className="shrink-0 text-right tabular-nums">{last.cell(row)}</div>}
          </div>
          {rest.length > 0 && (
            <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
              {rest.map((col) => (
                <div key={col.header} className="contents">
                  <dt className="text-muted">{col.header}</dt>
                  <dd className="text-right tabular-nums">{col.cell(row)}</dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}
