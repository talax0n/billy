import { Link } from "@tanstack/react-router";

type DocumentLink = { id: string; number: string } | null;

/**
 * Both ends of an Ubah on a detail sheet: "Diubah → <new>" on the replaced document and
 * "Perubahan dari <old>" on its replacement. `path` is the list page that opens a document
 * from its `?id=`.
 */
export function RevisionLinks({ path, revisionOf, revisedBy }: { path: string; revisionOf: DocumentLink; revisedBy: DocumentLink }) {
  const link = "text-ink-2 underline hover:text-ink";
  return (
    <>
      {revisedBy && (
        <Link to={path} search={{ id: revisedBy.id }} className={link}>
          Diubah → {revisedBy.number}
        </Link>
      )}
      {revisionOf && (
        <Link to={path} search={{ id: revisionOf.id }} className={link}>
          Perubahan dari {revisionOf.number}
        </Link>
      )}
    </>
  );
}
