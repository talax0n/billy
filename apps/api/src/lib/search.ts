import { and, ilike, type SQL } from "drizzle-orm";

/** `%term%` for ILIKE, with the user's own `%`, `_` and `\` matched literally. */
export const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, "\\$&")}%`;

/** Every whitespace-separated term of `q` must appear somewhere in `haystack`; undefined for a blank query. */
export function matchAllTerms(haystack: SQL, q: string): SQL | undefined {
  const terms = q.split(/\s+/).filter(Boolean);
  return terms.length ? and(...terms.map((term) => ilike(haystack, likePattern(term)))) : undefined;
}
