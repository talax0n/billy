import { expect, it } from "vitest";
import { aboveNormal, median, watchdogSettingsInput } from "./watchdog.ts";

it("takes the median of odd and even counts", () => {
  expect(median([])).toBe(0);
  expect(median([5, 1, 3])).toBe(3);
  expect(median([4, 1, 2, 3])).toBe(2.5);
});

it("calls a day above normal past max(3, 2 × the median)", () => {
  const quiet = Array<number>(30).fill(0);
  expect(aboveNormal(3, quiet)).toBe(false);
  expect(aboveNormal(4, quiet)).toBe(true);
  const busy = Array<number>(30).fill(5);
  expect(aboveNormal(10, busy)).toBe(false);
  expect(aboveNormal(11, busy)).toBe(true);
});

it("needs the shop to close after it opens", () => {
  expect(watchdogSettingsInput.safeParse({ openTime: "07:00", closeTime: "17:00" }).success).toBe(true);
  expect(watchdogSettingsInput.safeParse({ openTime: "17:00", closeTime: "07:00" }).success).toBe(false);
  expect(watchdogSettingsInput.safeParse({ openTime: "7:00", closeTime: "17:00" }).success).toBe(false);
});
