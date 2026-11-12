import { DomainError } from "./errors.ts";
import { rupiah, type Rupiah } from "./money.ts";

export interface CashAmount { direction: "in" | "out"; amount: Rupiah }

export function cashBalance(entries: readonly CashAmount[]): Rupiah {
  return rupiah(entries.reduce((sum, entry) => sum + (entry.direction === "in" ? entry.amount : -entry.amount), 0));
}

export function runningBalances<T extends CashAmount>(entries: readonly T[], opening: Rupiah = rupiah(0)) {
  let balance = opening;
  return entries.map((entry) => {
    balance = rupiah(balance + (entry.direction === "in" ? entry.amount : -entry.amount));
    return { ...entry, balance };
  });
}

export function validateTransfer(input: { fromAccountId: string; toAccountId: string; amount: Rupiah }): void {
  if (input.fromAccountId === input.toAccountId) throw new DomainError("invalid", "Akun asal dan tujuan harus berbeda");
  if (input.amount <= 0) throw new DomainError("invalid", "Jumlah harus lebih besar dari nol");
}
