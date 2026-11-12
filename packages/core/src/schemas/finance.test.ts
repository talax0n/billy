import { expect, it } from "vitest";
import { fieldErrors } from "./common.ts";
import { contactInput } from "./contacts.ts";
import { expenseInput, transferInput } from "./finance.ts";

const kas = "01a1d234-3800-7000-8000-000000000001";
const bca = "01a1d234-3800-7000-8000-000000000002";

it("rejects a transfer to the same account on the destination field", () => {
  const result = transferInput.safeParse({ fromAccountId: kas, toAccountId: kas, date: "2026-11-13", amount: 50_000 });
  expect(fieldErrors(result.error!)).toEqual({ toAccountId: "Akun tujuan harus berbeda dari akun asal" });
});

it("requires a positive amount and normalises a blank proof link to null", () => {
  expect(fieldErrors(transferInput.safeParse({ fromAccountId: kas, toAccountId: bca, date: "2026-11-13", amount: 0 }).error!)).toEqual({
    amount: "Jumlah harus lebih dari 0",
  });
  expect(expenseInput.parse({ date: "2026-11-13", accountId: kas, category: "Listrik", amount: 450_000, proofUrl: "" })).toEqual({
    date: "2026-11-13",
    accountId: kas,
    category: "Listrik",
    description: "",
    amount: 450_000,
    proofUrl: null,
  });
});

it("accepts a contact without email and applies default terms", () => {
  expect(contactInput.parse({ code: "CUST-0001", name: "Toko Maju", kind: "customer" })).toMatchObject({
    email: "",
    paymentTermsDays: 0,
    active: true,
  });
  expect(fieldErrors(contactInput.safeParse({ code: "", name: "X", kind: "customer", email: "bukan" }).error!)).toEqual({
    code: "Kode wajib diisi",
    email: "Email tidak valid",
  });
});
