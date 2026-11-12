import { expect, it } from "vitest";
import { uuidv7 } from "./ids.ts";

it("encodes the timestamp, version 7 and the RFC variant", () => {
  const id = uuidv7(Date.UTC(2026, 10, 13, 0, 0, 0));
  expect(id).toMatch(/^01a1d234-3800-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

it("sorts by creation time", () => {
  expect(uuidv7(1_000) < uuidv7(2_000)).toBe(true);
});
