import { expect, it } from "vitest";
import { terbilang } from "./terbilang.ts";

it.each([
  [0, "nol rupiah"],
  [11, "sebelas rupiah"],
  [15, "lima belas rupiah"],
  [100, "seratus rupiah"],
  [1_000, "seribu rupiah"],
  [1_115, "seribu seratus lima belas rupiah"],
  [21_000, "dua puluh satu ribu rupiah"],
  [246_000, "dua ratus empat puluh enam ribu rupiah"],
  [5_000_000, "lima juta rupiah"],
  [1_250_750, "satu juta dua ratus lima puluh ribu tujuh ratus lima puluh rupiah"],
  [2_000_000_000, "dua miliar rupiah"],
  [-500, "minus lima ratus rupiah"],
])("%i → %s", (value, expected) => {
  expect(terbilang(value)).toBe(expected);
});
