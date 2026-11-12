import { expect, it } from "vitest";
import { productInput, stockAdjustmentInput } from "./catalog.ts";
import { fieldErrors, paginationQuery } from "./common.ts";

it("applies pagination defaults and coerces query strings", () => {
  expect(paginationQuery.parse({})).toEqual({ q: "", page: 1, pageSize: 25 });
  expect(paginationQuery.parse({ q: " cat ", page: "3", pageSize: "50" })).toEqual({ q: "cat", page: 3, pageSize: 50 });
});

it("normalises blank product codes to null", () => {
  const parsed = productInput.parse({
    code: " ",
    barcode: null,
    name: "Cat Tembok Putih",
    unit: "kaleng",
    categoryId: null,
    sellPrice: 125_000,
    costPrice: 98_000,
    minStock: 2,
  });
  expect(parsed).toEqual({
    code: null,
    barcode: null,
    name: "Cat Tembok Putih",
    variant: "",
    unit: "kaleng",
    categoryId: null,
    sellPrice: 125_000,
    costPrice: 98_000,
    minStock: 2,
    active: true,
  });
});

it("reports the first message per field", () => {
  const result = stockAdjustmentInput.safeParse({ qty: 0, note: "" });
  expect(result.success).toBe(false);
  expect(fieldErrors(result.error!)).toEqual({ qty: "Jumlah tidak boleh 0", note: "Alasan penyesuaian wajib diisi" });
});
