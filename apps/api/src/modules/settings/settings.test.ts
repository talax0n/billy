import { expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

const { call, signIn } = await createTestApp();

it("lets only admin update the shop settings, and every role read them", async () => {
  const admin = await signIn("admin");
  const staff = await signIn("staff");
  const kasir = await signIn("kasir");
  const body = { shopName: "Toko Uji", receiptFooter: "Terima kasih", posDeviceCode: "k2" };

  expect((await call("/api/settings", { method: "PUT", cookie: staff.cookie, body })).status).toBe(403);
  const saved = await call("/api/settings", { method: "PUT", cookie: admin.cookie, body });
  expect(await saved.json()).toEqual({
    shopName: "Toko Uji",
    address: "",
    phone: "",
    whatsapp: "",
    invoiceBankText: "",
    invoiceSigner: "",
    receiptFooter: "Terima kasih",
    posDeviceCode: "K2",
    announcement: "",
    announcementUpdatedAt: null,
  });
  expect(await (await call("/api/settings", { cookie: kasir.cookie })).json()).toMatchObject({ shopName: "Toko Uji" });

  // Pengumuman: admin writes it, every role reads it, an unchanged save keeps its time.
  const announce = (cookie: string, announcement: string) => call("/api/settings/announcement", { method: "PUT", cookie, body: { announcement } });
  expect((await announce(staff.cookie, "Stok opname Sabtu")).status).toBe(403);
  const first = (await (await announce(admin.cookie, " Stok opname Sabtu ")).json()) as { announcement: string; announcementUpdatedAt: string };
  expect(first.announcement).toBe("Stok opname Sabtu");
  expect(await (await announce(admin.cookie, "Stok opname Sabtu")).json()).toEqual(first);
  expect(await (await call("/api/settings", { cookie: kasir.cookie })).json()).toMatchObject(first);
  expect(await (await announce(admin.cookie, "")).json()).toEqual({ announcement: "", announcementUpdatedAt: first.announcementUpdatedAt });
});
