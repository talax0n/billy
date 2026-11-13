import type { Role } from "@billy/core";
import { useSuspenseQuery } from "@tanstack/react-query";
import { type ComponentType, useState } from "react";
import { PageHeader } from "../../components/ui/page.tsx";
import { meQuery } from "../../lib/auth.ts";
import { cx } from "../../lib/cx.ts";
import { CategoriesTab } from "./categories-tab.tsx";
import { SecurityTab } from "./security-tab.tsx";
import { ShopTab } from "./shop-tab.tsx";
import { UsersTab } from "./users-tab.tsx";

const tabs: { label: string; roles: Role[]; component: ComponentType }[] = [
  { label: "Toko", roles: ["admin"], component: ShopTab },
  { label: "Pengguna", roles: ["admin"], component: UsersTab },
  { label: "Keamanan", roles: ["admin"], component: SecurityTab },
  { label: "Kategori", roles: ["admin", "staff"], component: CategoriesTab },
];

export function SettingsPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const visible = tabs.filter((tab) => me && tab.roles.includes(me.role));
  const [current, setCurrent] = useState(visible[0]!.label);
  const Tab = visible.find((tab) => tab.label === current)!.component;

  return (
    <>
      <PageHeader title="Pengaturan" />
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line px-6 max-md:px-4">
        {visible.map((tab) => (
          <button
            key={tab.label}
            type="button"
            role="tab"
            aria-selected={tab.label === current}
            onClick={() => setCurrent(tab.label)}
            className={cx(
              "-mb-px border-b-2 px-2 py-2.5 text-muted",
              tab.label === current ? "border-ink font-medium text-ink" : "border-transparent hover:text-ink",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <Tab />
    </>
  );
}
