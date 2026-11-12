/** `%term%` for ILIKE, with the user's own `%`, `_` and `\` matched literally. */
export const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, "\\$&")}%`;
