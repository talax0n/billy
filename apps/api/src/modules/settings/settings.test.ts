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
  });
  expect(await (await call("/api/settings", { cookie: kasir.cookie })).json()).toMatchObject({ shopName: "Toko Uji" });
});
