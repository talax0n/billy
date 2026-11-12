import { expect, it } from "vitest";
import { docPeriod, formatDocNumber, nextPosNumber } from "./numbering.ts";

it("formats server document numbers", () => {
  expect(docPeriod("2026-11-13")).toBe("261113");
  expect(formatDocNumber("SO", "2026-11-13", 7)).toBe("SO-261113-0007");
  expect(formatDocNumber("BY", "2027-01-02", 12345)).toBe("BY-270102-12345");
});

it("counts POS receipts per device and restarts each day", () => {
  expect(nextPosNumber("K1", "2026-11-13", null)).toEqual({ number: "K1-261113-0001", period: "261113", value: 1 });
  expect(nextPosNumber("K1", "2026-11-13", { period: "261113", value: 41 })).toEqual({
    number: "K1-261113-0042",
    period: "261113",
    value: 42,
  });
  expect(nextPosNumber("K1", "2026-11-14", { period: "261113", value: 41 }).number).toBe("K1-261114-0001");
});
