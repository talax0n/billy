const ones = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
const scales: [number, string][] = [
  [1e12, "triliun"],
  [1e9, "miliar"],
  [1e6, "juta"],
];

function below1000(n: number): string {
  if (n < 12) return ones[n]!;
  if (n < 20) return `${ones[n - 10]} belas`;
  if (n < 100) return [`${ones[Math.floor(n / 10)]} puluh`, ones[n % 10]].filter(Boolean).join(" ");
  const head = n < 200 ? "seratus" : `${ones[Math.floor(n / 100)]} ratus`;
  return [head, below1000(n % 100)].filter(Boolean).join(" ");
}

function words(n: number): string {
  for (const [scale, name] of scales) {
    if (n >= scale) return [`${words(Math.floor(n / scale))} ${name}`, words(n % scale)].filter(Boolean).join(" ");
  }
  if (n >= 1000) {
    const head = n < 2000 ? "seribu" : `${below1000(Math.floor(n / 1000))} ribu`;
    return [head, below1000(n % 1000)].filter(Boolean).join(" ");
  }
  return below1000(n);
}

/** Whole rupiah in Indonesian words, as a "terbilang" line prints it: `5000000` → `lima juta rupiah`. */
export function terbilang(value: number): string {
  const abs = Math.abs(Math.trunc(value));
  return `${value < 0 ? "minus " : ""}${abs === 0 ? "nol" : words(abs)} rupiah`;
}
