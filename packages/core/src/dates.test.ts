import { expect, it } from "vitest";
import { addDays, businessDate, formatDate } from "./dates.ts";

it("uses the Jakarta calendar day, not UTC", () => {
  expect(businessDate(new Date("2026-11-12T16:59:59Z"))).toBe("2026-11-12");
  expect(businessDate(new Date("2026-11-12T17:00:00Z"))).toBe("2026-11-13");
});

it("adds days across month and year ends", () => {
  expect(addDays("2026-11-13", 30)).toBe("2026-12-13");
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
});

it("formats in Indonesian", () => {
  expect(formatDate("2026-11-13")).toBe("13 Nov 2026");
  expect(formatDate("2026-08-05")).toBe("5 Agu 2026");
});
