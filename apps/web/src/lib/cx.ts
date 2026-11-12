/** Joins class names, skipping falsy ones. */
export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");
