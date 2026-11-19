import { describe, expect, it } from "vitest";
import { bestMatch, rankProducts } from "./product-match.ts";

describe("bestMatch", () => {
  const products = [
    { id: "a-g", name: "CATYLAC EXTERIOR BASE A GALON", unit: "GALON" },
    { id: "a-p", name: "CATYLAC EXTERIOR BASE A PAIL", unit: "PAIL" },
    { id: "b-g", name: "CATYLAC EXTERIOR BASE B GALON", unit: "GALON" },
    { id: "i-a-g", name: "CATYLAC INTERIOR BASE A GALON", unit: "GALON" },
  ];

  it("reads the fill as billy's unit", () => {
    expect(bestMatch("CATYLAC EXTERIOR BASE A 5 KG", products)).toEqual({ product: products[0], confidence: "pasti" });
    expect(bestMatch("CATYLAC EXTERIOR BASE A 25KG", products)).toEqual({ product: products[1], confidence: "pasti" });
  });

  it("never crosses a base letter or a size, and weighs the words that tell variants apart", () => {
    const dulux = [
      { id: "ws-a", name: "DULUX WEATHERSHIELD BASE A GALON", unit: "GALON" },
      { id: "dirt-a", name: "DULUX WEATHERSHIELD DIRT RESISTANCE BASE A 2,5 LITER", unit: "GALON" },
      { id: "penta-a", name: "DULUX PENTALITE BASE A 2,5 LITER", unit: "GALON" },
      { id: "penta-b", name: "DULUX PENTALITE BASE B 2,5 LITER", unit: "GALON" },
      { id: "penta-a-p", name: "PENTALITE BASE A PAIL", unit: "PAIL" },
      { id: "int-a", name: "CATYLAC INTERIOR BASE A GALON", unit: "GALON" },
    ];
    expect(bestMatch("DULUX WEATHERSHIELD BASE A 2,5 LITER", dulux).product?.id).toBe("ws-a");
    expect(bestMatch("DULUX PENTALITE BASE A 2,5 LITER", dulux).product?.id).toBe("penta-a");
    expect(bestMatch("DULUX PENTALITE BASE A 20 LTR", dulux).product?.id).toBe("penta-a-p");
    expect(bestMatch("DULUX CATYLAC INT BASE A 5 KG", dulux).product?.id).toBe("int-a");
    expect(bestMatch("DULUX PENTALITE BASE C 2,5 LITER", dulux).product).toBeNull();
  });

  it("asks for a check when it is close, and gives up when nothing fits", () => {
    expect(bestMatch("CATYLAC BASE A", products).confidence).toBe("cek");
    expect(bestMatch("TINTA BLK", products)).toEqual({ product: null, confidence: "tidak ketemu" });
  });
});

describe("rankProducts", () => {
  it("lists the closest products first and leaves out other bases and sizes", () => {
    const products = [
      { id: "a-g", name: "CATYLAC EXTERIOR BASE A GALON", unit: "GALON" },
      { id: "a-p", name: "CATYLAC EXTERIOR BASE A PAIL", unit: "PAIL" },
      { id: "b-g", name: "CATYLAC EXTERIOR BASE B GALON", unit: "GALON" },
      { id: "i-a-g", name: "CATYLAC INTERIOR BASE A GALON", unit: "GALON" },
    ];
    expect(rankProducts("catylac ext base a galon", products).map((r) => r.product.id)).toEqual(["a-g", "i-a-g"]);
  });
});
