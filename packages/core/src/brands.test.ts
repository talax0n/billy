import { describe, expect, it } from "vitest";
import { brandOf, brandRules } from "./brands.ts";

describe("brandOf", () => {
  it("reads the brand from the sub-brand a name starts with", () => {
    expect(brandOf("CATYLAC EXTERIOR BASE A GALON")).toBe("Dulux");
    expect(brandOf("WEATHERBOND SOLAREFLECT BASE A PAIL")).toBe("Nippon Paint");
    expect(brandOf("NIPPELUX MARINE ENAMEL")).toBe("Nippon Paint");
    expect(brandOf("GO FAST A-1000 DOFF BASE B PAIL")).toBe("Propan");
    expect(brandOf("P 05 EBONY LITER")).toBe("Propan");
    expect(brandOf("NO DROP KOLAM IKAN 067 GALON")).toBe("Avian");
    expect(brandOf("  danagloss   white  ")).toBe("Danapaint");
  });

  it("matches whole words only", () => {
    expect(brandOf("BEEHIVE WAX")).toBeNull();
    expect(brandOf("ECONOMY ROLL")).toBeNull();
    expect(brandOf("PUL 765 GLOSS BASE D GALON")).toBe("Propan");
    expect(brandOf("PULAS KAYU")).toBeNull();
  });

  it("leaves unknown names without a brand", () => {
    expect(brandOf("TOP COLOR 1156 LIGHT IVORY LITER")).toBeNull();
    expect(brandOf("")).toBeNull();
  });

  it("gives every prefix to exactly one brand", () => {
    const prefixes = brandRules.flatMap((r) => r.prefixes);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
