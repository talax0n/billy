import { describe, expect, it } from "vitest";
import { DomainError } from "./errors.ts";
import { rupiah } from "./money.ts";
import {
  allocatePayment,
  ageReceivables,
  agingBucket,
  assertInvoiceVoidable,
  assertPaymentAllowed,
} from "./sales.ts";
import { deriveInvoiceStatus } from "./status.ts";

const today = "2026-11-13";

describe("agingBucket", () => {
  it("splits on the day boundaries", () => {
    expect(agingBucket("2026-11-13", today)).toBe("current");
    expect(agingBucket("2026-12-01", today)).toBe("current");
    expect(agingBucket("2026-11-12", today)).toBe("d1_30");
    expect(agingBucket("2026-10-14", today)).toBe("d1_30"); // 30 days
    expect(agingBucket("2026-10-13", today)).toBe("d31_60"); // 31 days
    expect(agingBucket("2026-09-14", today)).toBe("d31_60"); // 60 days
    expect(agingBucket("2026-09-13", today)).toBe("d61_90"); // 61 days
    expect(agingBucket("2026-08-15", today)).toBe("d61_90"); // 90 days
    expect(agingBucket("2026-08-14", today)).toBe("d90_plus"); // 91 days
  });
});

describe("ageReceivables", () => {
  it("groups outstanding per customer and skips settled invoices", () => {
    const result = ageReceivables(
      [
        { customerId: "a", dueDate: "2026-11-20", outstanding: rupiah(500_000) },
        { customerId: "a", dueDate: "2026-10-01", outstanding: rupiah(250_000) },
        { customerId: "a", dueDate: "2026-07-01", outstanding: rupiah(100_000) },
        { customerId: "b", dueDate: "2026-11-01", outstanding: rupiah(0) },
      ],
      today,
    );
    expect(result.get("a")).toEqual({
      current: 500_000,
      d1_30: 0,
      d31_60: 250_000,
      d61_90: 0,
      d90_plus: 100_000,
      total: 850_000,
      invoiceCount: 3,
    });
    expect(result.has("b")).toBe(false);
  });
});

const state = (paid: number, dueDate = "2026-11-20", voided = false) =>
  deriveInvoiceStatus({ total: rupiah(1_000_000), paid: rupiah(paid), dueDate, voided, today });

describe("assertPaymentAllowed", () => {
  it("accepts up to the outstanding amount", () => {
    expect(() => assertPaymentAllowed(state(400_000), rupiah(600_000))).not.toThrow();
  });

  it("rejects overpayment, zero and void invoices", () => {
    expect(() => assertPaymentAllowed(state(400_000), rupiah(600_001))).toThrow(
      new DomainError("invalid", "Pembayaran melebihi sisa tagihan Rp 600.000"),
    );
    expect(() => assertPaymentAllowed(state(0), rupiah(0))).toThrow(DomainError);
    expect(() => assertPaymentAllowed(state(0, today, true), rupiah(1))).toThrow("Faktur sudah dibatalkan");
  });
});

describe("assertInvoiceVoidable", () => {
  it("refuses while payments stand or when already void", () => {
    expect(() => assertInvoiceVoidable({ voided: false, activePayments: 0 })).not.toThrow();
    expect(() => assertInvoiceVoidable({ voided: false, activePayments: 1 })).toThrow("Batalkan dulu semua pembayaran faktur ini");
    expect(() => assertInvoiceVoidable({ voided: true, activePayments: 0 })).toThrow("Faktur sudah dibatalkan");
  });
});

describe("allocatePayment", () => {
  const inv = (number: string, dueDate: string, outstanding: number) => ({
    id: number,
    number,
    date: "2026-10-01",
    dueDate,
    outstanding: rupiah(outstanding),
  });
  const a = inv("SO-A", "2026-11-20", 300_000);
  const b = inv("SO-B", "2026-11-01", 500_000);
  const c = inv("SO-C", "2026-11-10", 200_000);
  const split = (amount: number) => allocatePayment([a, b, c], rupiah(amount)).map((s) => [s.invoice.number, s.amount]);

  it("pays the earliest due faktur first and leaves the last one reached partly paid", () => {
    expect(split(600_000)).toEqual([
      ["SO-B", 500_000],
      ["SO-C", 100_000],
    ]);
  });

  it("pays every faktur in full when the amount covers them all", () => {
    expect(split(1_000_000)).toEqual([
      ["SO-B", 500_000],
      ["SO-C", 200_000],
      ["SO-A", 300_000],
    ]);
  });

  it("refuses zero and more than what is owed", () => {
    expect(() => split(0)).toThrow("Jumlah pembayaran harus lebih dari 0");
    expect(() => split(1_000_001)).toThrow("Pembayaran melebihi sisa tagihan Rp 1.000.000");
  });
});
