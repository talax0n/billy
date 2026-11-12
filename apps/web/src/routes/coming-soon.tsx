import { EmptyState, PageHeader } from "../components/ui/page.tsx";

export function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState title="Segera hadir" description="Halaman ini sedang dibuat." />
    </>
  );
}
