import { twMerge } from "tailwind-merge";

/** Joins class names, skipping falsy ones; a later Tailwind class wins over a conflicting earlier one, so callers can override widths. */
export const cx = (...classes: (string | false | null | undefined)[]) => twMerge(...classes);
