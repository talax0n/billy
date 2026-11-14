import { businessDate, rupiah } from "@billy/core";
import { count } from "drizzle-orm";
import type { Db } from "./client.ts";
import { accounts, categories, products, settings, stockMovements, users } from "./schema.ts";

export async function isEmpty(db: Db): Promise<boolean> {
  const [row] = await db.select({ n: count() }).from(users);
  return row!.n === 0;
}

const sampleCategories = [
  { name: "Cat Tembok", description: "Cat dinding interior dan eksterior" },
  { name: "Cat Kayu & Besi", description: "Enamel dan cat minyak" },
  { name: "Pelapis Anti Bocor", description: "Waterproofing atap dan dinding" },
  { name: "Thinner & Pelarut", description: "" },
  { name: "Alat Cat", description: "Kuas, roll, amplas" },
];

// [category index, code, name, variant, unit, sell, cost, min stock, opening stock]
const sampleProducts: [number, string, string, string, string, number, number, number, number][] = [
  [0, "CT-001", "Warnaku Tembok", "Putih 5 kg", "pail", 185_000, 152_000, 5, 24],
  [0, "CT-002", "Warnaku Tembok", "Putih 25 kg", "pail", 820_000, 690_000, 2, 6],
  [0, "CT-003", "Warnaku Tembok", "Abu Muda 5 kg", "pail", 189_000, 155_000, 3, 9],
  [0, "CT-004", "Dindingku Eksterior", "Putih 2,5 L", "kaleng", 145_000, 118_000, 4, 11],
  [0, "CT-005", "Dindingku Eksterior", "Krem 2,5 L", "kaleng", 149_000, 121_000, 4, 3],
  [0, "CT-006", "Dasar Tembok Alkali", "20 kg", "pail", 465_000, 388_000, 2, 5],
  [1, "KB-001", "Kilau Enamel", "Hitam 1 L", "kaleng", 78_000, 61_000, 6, 18],
  [1, "KB-002", "Kilau Enamel", "Merah 1 L", "kaleng", 78_000, 61_000, 6, 7],
  [1, "KB-003", "Kilau Enamel", "Putih 1 L", "kaleng", 78_000, 61_000, 6, 22],
  [1, "KB-004", "Meni Besi Antikarat", "Abu 1 kg", "kaleng", 64_000, 49_500, 5, 14],
  [1, "KB-005", "Pelitur Jati", "1 L", "kaleng", 92_000, 73_000, 3, 4],
  [2, "AB-001", "Atap Kering", "Abu 4 kg", "galon", 235_000, 191_000, 3, 8],
  [2, "AB-002", "Atap Kering", "Hijau 4 kg", "galon", 235_000, 191_000, 3, 2],
  [2, "AB-003", "Semen Pelapis Elastis", "20 kg", "sak", 410_000, 344_000, 2, 6],
  [3, "TH-001", "Thinner Super", "1 L", "botol", 32_000, 24_500, 12, 40],
  [3, "TH-002", "Thinner Super", "5 L", "galon", 145_000, 116_000, 4, 10],
  [3, "TH-003", "Minyak Cat", "1 L", "botol", 28_000, 21_000, 6, 15],
  [4, "AL-001", "Kuas Sapuan", '3"', "pcs", 18_000, 11_500, 10, 35],
  [4, "AL-002", "Roll Cat Tembok", '9"', "pcs", 42_000, 29_000, 5, 12],
  [4, "AL-003", "Amplas Kertas", "No. 240", "lembar", 3_500, 2_100, 50, 180],
];

/** First-run data for an empty database: admin, settings, accounts, sample catalog with opening stock. */
export async function seed(db: Db, options: { adminPasswordHash: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [admin] = await tx
      .insert(users)
      .values({ username: "admin", name: "Pemilik", role: "admin", passwordHash: options.adminPasswordHash })
      .returning({ id: users.id });

    await tx.insert(settings).values({
      shopName: "Toko Cat Sumber Karya",
      address: "Jl. Contoh No. 1, Kota Contoh",
      phone: "0000-000000",
      invoiceSigner: "Pemilik",
      receiptFooter: "Terima kasih. Barang tinting tidak bisa retur.",
      posDeviceCode: "K1",
    });

    await tx.insert(accounts).values([
      { code: "KAS", name: "Kas Toko", kind: "cash" },
      { code: "BCA", name: "BCA Operasional", kind: "bank" },
      { code: "MANDIRI", name: "Mandiri", kind: "bank" },
      { code: "BRI", name: "BRI", kind: "bank" },
      { code: "QRIS", name: "QRIS", kind: "ewallet" },
    ]);

    const categoryRows = await tx.insert(categories).values(sampleCategories).returning({ id: categories.id });
    const productRows = await tx
      .insert(products)
      .values(
        sampleProducts.map(([cat, code, name, variant, unit, sell, cost, minStock]) => ({
          categoryId: categoryRows[cat]!.id,
          code,
          name,
          variant,
          unit,
          sellPrice: rupiah(sell),
          costPrice: rupiah(cost),
          minStock,
        })),
      )
      .returning({ id: products.id, costPrice: products.costPrice });

    const today = businessDate();
    await tx.insert(stockMovements).values(
      productRows.map((p, i) => ({
        productId: p.id,
        date: today,
        qty: sampleProducts[i]![8],
        reason: "adjustment" as const,
        unitCost: p.costPrice,
        note: "Stok awal",
        createdBy: admin!.id,
      })),
    );
  });
}
