/**
 * Classes that turn a document's line-item table into stacked cards below `md`:
 * product on the first row with the remove button, then labelled fields two-up.
 * Field cells need `data-label`, shown as their caption on phones.
 */
export const lineTable = {
  table: "max-md:block max-md:min-w-0",
  head: "max-md:hidden",
  body: "max-md:block",
  row: "max-md:grid max-md:grid-cols-6 max-md:gap-x-2 max-md:gap-y-1.5 max-md:px-3 max-md:py-2.5",
  index: "max-md:hidden",
  product: "max-md:col-span-5 max-md:p-0",
  wide: "max-md:col-span-6 max-md:p-0",
  field:
    "max-md:col-span-2 max-md:p-0 max-md:before:mb-0.5 max-md:before:block max-md:before:text-xs max-md:before:text-muted max-md:before:content-[attr(data-label)]",
  remove: "max-md:col-start-6 max-md:row-start-1 max-md:justify-self-end max-md:p-0",
};
