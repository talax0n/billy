import type { ReactNode } from "react";

/** One titled block of a settings page; blocks after the first get a divider above. */
export function SettingsSection({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 not-first:border-t not-first:border-line not-first:pt-6">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-muted">{description}</p>
      </div>
      {children}
    </section>
  );
}
