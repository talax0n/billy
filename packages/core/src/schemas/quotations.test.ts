import { expect, it } from "vitest";
import { quotationInput, quotationStatus } from "./quotations.ts";

it("reads a draft or sent quote past its valid-until date as expired, never an accepted or rejected one", () => {
  expect(quotationStatus("draft", "2026-11-12", "2026-11-13")).toBe("expired");
  expect(quotationStatus("sent", "2026-11-12", "2026-11-13")).toBe("expired");
  expect(quotationStatus("sent", "2026-11-13", "2026-11-13")).toBe("sent");
  expect(quotationStatus("accepted", "2026-11-01", "2026-11-13")).toBe("accepted");
  expect(quotationStatus("rejected", "2026-11-01", "2026-11-13")).toBe("rejected");
});

it("refuses a valid-until date before the quote date", () => {
  const result = quotationInput.safeParse({
    customerId: "01a1d234-3800-7000-8000-000000000001",
    date: "2026-11-13",
    validUntil: "2026-11-12",
    discountKind: "none",
    discountValue: 0,
    lines: [{ productId: "01a1d234-3800-7000-8000-000000000002", qty: 1, unitPrice: 1_000 }],
  });
  expect(result.success ? null : result.error.issues[0]).toMatchObject({ path: ["validUntil"], message: "Tidak boleh sebelum tanggal penawaran" });
});
