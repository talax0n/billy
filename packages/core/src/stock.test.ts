import { expect, it } from "vitest";
import { needsAttention, stockLevel } from "./stock.ts";

it("classifies stock against the minimum", () => {
  expect(stockLevel(-1, 0)).toBe("negative");
  expect(stockLevel(1, 2)).toBe("low");
  expect(stockLevel(0, 2)).toBe("low");
  expect(stockLevel(2, 2)).toBe("ok");
  expect(stockLevel(0, 0)).toBe("empty");
});

it("asks for attention only when negative or under the minimum", () => {
  expect(["negative", "low", "empty", "ok"].filter((l) => needsAttention(l as never))).toEqual(["negative", "low"]);
});
