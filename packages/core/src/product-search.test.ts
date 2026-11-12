import { describe, expect, it } from "vitest";
import { productMatchRank, rankProducts } from "./product-search.ts";

const product = (name: string, variant: string, code: string | null = null, barcode: string | null = null) => ({ name, variant, code, barcode });

describe("rankProducts", () => {
  const catalog = [
    product("Avian Tembok", "Putih 25 kg", "AV-25"),
    product("Avian Tembok", "Putih 5 kg", "AV-5"),
    product("Avian Tembok", "Putih Susu 5 kg", "AV-5S"),
    product("Kuas Putihan", "5 inch", "KP-5"),
    product("Thinner", "1 L", "PUTIH5", "8991234567890"),
  ];
  const names = (query: string) => rankProducts(catalog, query).map((p) => `${p.name} ${p.variant}`);

  it("puts whole-word matches before prefix and substring matches", () => {
    expect(names("putih 5")).toEqual(["Avian Tembok Putih 5 kg", "Avian Tembok Putih Susu 5 kg", "Kuas Putihan 5 inch", "Avian Tembok Putih 25 kg", "Thinner 1 L"]);
  });

  it("puts an exact code or barcode first", () => {
    expect(names("putih5")).toEqual(["Thinner 1 L"]);
    expect(names("av-5")[0]).toBe("Avian Tembok Putih 5 kg");
    expect(names("8991234567890")).toEqual(["Thinner 1 L"]);
  });

  it("ranks each tier", () => {
    expect(productMatchRank(catalog[1]!, "AV-5")).toBe(0);
    expect(productMatchRank(catalog[1]!, "putih 5")).toBe(1);
    expect(productMatchRank(catalog[3]!, "putih 5")).toBe(2);
    expect(productMatchRank(catalog[0]!, "putih 5")).toBe(3);
    expect(productMatchRank(catalog[0]!, "merah")).toBeNull();
    expect(productMatchRank(catalog[0]!, "  ")).toBeNull();
  });
});
