import { describe, expect, it } from "vitest";
import { deliveryStatuses, driverTurnOrder, nextDeliveryStatus } from "./deliveries.ts";

describe("nextDeliveryStatus", () => {
  it("allows exactly the listed moves", () => {
    const table = Object.fromEntries(
      deliveryStatuses.map((from) => [
        from,
        Object.fromEntries(
          (["depart", "deliver", "requeue", "cancel"] as const).map((action) => {
            try {
              return [action, nextDeliveryStatus(from, action)];
            } catch {
              return [action, null];
            }
          }),
        ),
      ]),
    );
    expect(table).toEqual({
      waiting: { depart: "on_the_way", deliver: null, requeue: null, cancel: "cancelled" },
      on_the_way: { depart: null, deliver: "delivered", requeue: "waiting", cancel: "cancelled" },
      delivered: { depart: null, deliver: null, requeue: null, cancel: null },
      cancelled: { depart: null, deliver: null, requeue: null, cancel: null },
    });
  });

  it("explains a refused move in Indonesian", () => {
    expect(() => nextDeliveryStatus("delivered", "depart")).toThrow('Tidak bisa "Berangkat": antaran ini statusnya sudah sampai');
  });
});

describe("driverTurnOrder", () => {
  it("puts never-delivered first, then the one back longest, and skips busy or inactive drivers", () => {
    const order = driverTurnOrder([
      { name: "Dodi", active: true, busy: false, lastDeliveredAt: "2026-11-14T03:00:00.000Z" },
      { name: "Andi", active: true, busy: false, lastDeliveredAt: "2026-11-14T05:00:00.000Z" },
      { name: "Wawan", active: true, busy: false, lastDeliveredAt: null },
      { name: "Bayu", active: true, busy: false, lastDeliveredAt: null },
      { name: "Eko", active: true, busy: true, lastDeliveredAt: null },
      { name: "Fajar", active: false, busy: false, lastDeliveredAt: null },
    ]);
    expect(order.map((d) => d.name)).toEqual(["Bayu", "Wawan", "Dodi", "Andi"]);
  });
});
