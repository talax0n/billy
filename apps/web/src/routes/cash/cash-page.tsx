import { accountKindLabels } from "@billy/core";
import type { InferResponseType } from "hono/client";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { DataTable, usePagedQuery } from "../../components/ui/data-table.tsx";
import { EmptyState, PageBody, PageHeader, StatTile } from "../../components/ui/page.tsx";
import { api, unwrap } from "../../lib/api.ts";
import { AccountSheet, Balance } from "./account-sheet.tsx";
import { type CashAction, CashDialog } from "./cash-dialogs.tsx";

type AccountPage = InferResponseType<typeof api.accounts.$get, 200>;
export type AccountRow = AccountPage["rows"][number];

export function CashPage() {
  const paged = usePagedQuery(["accounts", "list"], (params) =>
    unwrap(api.accounts.$get({ query: { q: params.q, page: String(params.page), pageSize: String(params.pageSize) } })),
  );
  /** null: closed; "new": create form; a string: the account whose cash book is open. */
  const [open, setOpen] = useState<string | null>(null);
  const [action, setAction] = useState<CashAction | null>(null);
  // usePagedQuery types the page as `{ rows, total }`; the response also carries the combined balance.
  const balanceTotal = (paged.query.data as AccountPage | undefined)?.balanceTotal;

  return (
    <>
      <PageHeader
        title="Kas & Bank"
        description="Saldo setiap akun dihitung dari mutasi kasnya."
        actions={
          <>
            <Button onClick={() => setAction("in")}>
              <ArrowDownLeft className="size-4" />
              Uang masuk
            </Button>
            <Button onClick={() => setAction("out")}>
              <ArrowUpRight className="size-4" />
              Uang keluar
            </Button>
            <Button onClick={() => setAction("transfer")}>
              <ArrowLeftRight className="size-4" />
              Transfer
            </Button>
            <Button variant="primary" onClick={() => setOpen("new")}>
              <Plus className="size-4" />
              Akun baru
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="grid grid-cols-3 gap-3.5">
          <StatTile
            label="Total saldo kas & bank"
            value={balanceTotal === undefined ? "—" : <Balance value={balanceTotal} />}
            note="Semua akun, termasuk yang nonaktif"
          />
        </div>
        <DataTable
          paged={paged}
          searchPlaceholder="Cari nama atau kode akun…"
          onRowClick={(row) => setOpen(row.id)}
          empty={<EmptyState title="Belum ada akun" action={<Button onClick={() => setOpen("new")}>Tambah akun</Button>} />}
          columns={[
            { header: "Kode", cell: (a) => <span className="text-muted">{a.code}</span>, className: "w-32" },
            {
              header: "Nama",
              cell: (a) => (
                <span className="flex items-center gap-2">
                  {a.name}
                  {!a.active && <Badge>Nonaktif</Badge>}
                </span>
              ),
            },
            { header: "Jenis", cell: (a) => <span className="text-ink-2">{accountKindLabels[a.kind]}</span> },
            { header: "Saldo", align: "right", cell: (a) => <Balance value={a.balance} /> },
          ]}
        />
      </PageBody>
      {open && <AccountSheet accountId={open === "new" ? null : open} onOpenAccount={setOpen} onClose={() => setOpen(null)} />}
      <CashDialog action={action} accountId="" onClose={() => setAction(null)} />
    </>
  );
}
