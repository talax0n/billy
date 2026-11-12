import { expect, it } from "vitest";
import { nextContactCode } from "./contacts.ts";

it("suggests the next number per kind prefix", () => {
  expect(nextContactCode("customer", [])).toBe("CUST-0001");
  expect(nextContactCode("customer", ["CUST-0006", "CUST-0002", "SUPP-0040"])).toBe("CUST-0007");
  expect(nextContactCode("supplier", ["SUPP-0009"])).toBe("SUPP-0010");
  expect(nextContactCode("employee", ["EMP-12"])).toBe("EMP-0013");
  expect(nextContactCode("other", ["OTH-LAMA", "OTHX-0005"])).toBe("OTH-0001");
});

it("widens past 9999 instead of wrapping", () => {
  expect(nextContactCode("customer", ["CUST-9999"])).toBe("CUST-10000");
});
