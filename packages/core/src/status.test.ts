import { expect, it } from "vitest";
import { rupiah } from "./money.ts";
import { deriveInvoiceStatus } from "./status.ts";

const base = { total: rupiah(1_000_000), dueDate: "2026-11-10", today: "2026-11-13", voided: false };

it("derives unpaid, partial and paid", () => {
  expect(deriveInvoiceStatus({ ...base, paid: rupiah(0) })).toEqual({
    status: "unpaid",
    outstanding: 1_000_000,
    overdue: true,
  });
  expect(deriveInvoiceStatus({ ...base, paid: rupiah(400_000), dueDate: "2026-11-13" })).toEqual({
    status: "partial",
    outstanding: 600_000,
    overdue: false,
  });
  expect(deriveInvoiceStatus({ ...base, paid: rupiah(1_000_000) })).toEqual({
    status: "paid",
    outstanding: 0,
    overdue: false,
  });
});

it("never marks a void invoice overdue", () => {
  expect(deriveInvoiceStatus({ ...base, paid: rupiah(0), voided: true })).toEqual({
    status: "void",
    outstanding: 0,
    overdue: false,
  });
});
