import { DomainError } from "./errors.ts";

export const deliveryStatuses = ["waiting", "on_the_way", "delivered", "cancelled"] as const;
export type DeliveryStatus = (typeof deliveryStatuses)[number];

export const deliveryStatusLabels: Record<DeliveryStatus, string> = {
  waiting: "Menunggu",
  on_the_way: "Sedang diantar",
  delivered: "Sudah sampai",
  cancelled: "Batal",
};

/** The only moves a delivery can make. The API refuses anything not listed here. */
export const deliveryTransitions = {
  depart: { from: ["waiting"], to: "on_the_way", label: "Berangkat" },
  deliver: { from: ["on_the_way"], to: "delivered", label: "Sudah sampai" },
  requeue: { from: ["on_the_way"], to: "waiting", label: "Kembali ke antrian" },
  cancel: { from: ["waiting", "on_the_way"], to: "cancelled", label: "Batalkan" },
} as const satisfies Record<string, { from: readonly DeliveryStatus[]; to: DeliveryStatus; label: string }>;

export type DeliveryAction = keyof typeof deliveryTransitions;

/** The status after `action`, or a DomainError (409) naming why it cannot happen now. */
export function nextDeliveryStatus(from: DeliveryStatus, action: DeliveryAction): DeliveryStatus {
  const move = deliveryTransitions[action];
  if ((move.from as readonly DeliveryStatus[]).includes(from)) return move.to;
  throw new DomainError("conflict", `Tidak bisa "${move.label}": antaran ini statusnya ${deliveryStatusLabels[from].toLowerCase()}`);
}

export interface DriverTurn {
  name: string;
  active: boolean;
  /** Has a delivery on the way. */
  busy: boolean;
  /** ISO time of their latest finished delivery, null if they never delivered. */
  lastDeliveredAt: string | null;
}

/**
 * Who goes next: active drivers with nothing on the way, the one back longest first.
 * Never-delivered drivers come first, ties by name. Derived on every read, never stored.
 */
export function driverTurnOrder<T extends DriverTurn>(drivers: readonly T[]): T[] {
  return drivers
    .filter((d) => d.active && !d.busy)
    .sort(
      (a, b) =>
        (a.lastDeliveredAt === null ? 0 : 1) - (b.lastDeliveredAt === null ? 0 : 1) ||
        (a.lastDeliveredAt ?? "").localeCompare(b.lastDeliveredAt ?? "") ||
        a.name.localeCompare(b.name, "id"),
    );
}
