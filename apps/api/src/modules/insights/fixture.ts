import { addDays, businessDate, rupiah, uuidv7 } from "@billy/core";
import {
  accounts,
  cashEntries,
  contacts,
  type Db,
  expenses,
  payments,
  posLines,
  posSales,
  products,
  purchaseInvoices,
  purchaseLines,
  salesInvoices,
  salesLines,
  stockMovements,
  transfers,
} from "@billy/db";
import { eq } from "drizzle-orm";

export async function seedInsightDemo(
  db: Db,
  userId: string,
  today = businessDate(),
) {
  if (process.env.NODE_ENV === "production")
    throw new Error("Fixture hanya untuk pengembangan");
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(accounts)
      .where(eq(accounts.code, "DEMO-KAS"));
    if (existing.length) return { inserted: false };
    const cashId = uuidv7(),
      bankId = uuidv7(),
      customerId = uuidv7(),
      supplierId = uuidv7(),
      productId = uuidv7();
    await tx.insert(accounts).values([
      { id: cashId, code: "DEMO-KAS", name: "Kas Toko (demo)", kind: "cash" },
      {
        id: bankId,
        code: "DEMO-BANK",
        name: "Bank Operasional (demo)",
        kind: "bank",
      },
    ]);
    await tx.insert(contacts).values([
      {
        id: customerId,
        code: "DEMO-C",
        name: "PT Warna Imajinasi",
        kind: "customer",
      },
      {
        id: supplierId,
        code: "DEMO-S",
        name: "CV Pelangi Fiktif",
        kind: "supplier",
      },
    ]);
    await tx.insert(products).values({
      id: productId,
      code: "DEMO-CAT",
      name: "Cat Tembok Awan",
      unit: "pail",
      sellPrice: rupiah(200000),
      costPrice: rupiah(150000),
      minStock: 20,
    });
    const cash = async (
      date: string,
      direction: "in" | "out",
      amount: number,
      sourceType: typeof cashEntries.$inferInsert.sourceType,
      sourceId: string | null,
      category: typeof cashEntries.$inferInsert.category,
      accountId = cashId,
    ) => {
      await tx.insert(cashEntries).values({
        accountId,
        date,
        direction,
        amount: rupiah(amount),
        sourceType,
        sourceId,
        category,
        createdBy: userId,
        note: "Data contoh",
      });
    };
    const movement = async (
      date: string,
      qty: number,
      reason: typeof stockMovements.$inferInsert.reason,
      sourceType: typeof stockMovements.$inferInsert.sourceType,
      sourceId: string | null,
      id = productId,
    ) => {
      await tx.insert(stockMovements).values({
        productId: id,
        date,
        qty,
        reason,
        unitCost: rupiah(150000),
        sourceType,
        sourceId,
        createdBy: userId,
      });
    };
    await cash(
      addDays(today, -180),
      "in",
      20000000,
      "manual",
      null,
      "other_in",
    );
    await cash(
      addDays(today, -180),
      "in",
      30000000,
      "manual",
      null,
      "other_in",
      bankId,
    );
    const date = addDays(today, -10);
    for (let i = 5; i >= 0; i--) {
      const day = addDays(date, -30 * i);
      const saleId = uuidv7(),
        purchaseId = uuidv7(),
        posId = uuidv7(),
        expenseId = uuidv7();
      const total = rupiah((20 + i) * 200000),
        purchaseTotal = rupiah((30 + i) * 150000),
        posTotal = rupiah((5 + i) * 200000);
      await tx.insert(salesInvoices).values({
        id: saleId,
        number: `DEMO-SO-${i}`,
        customerId,
        date: day,
        dueDate: addDays(day, 7),
        termsDays: 7,
        subtotal: total,
        total,
        discountAmount: rupiah(0),
        createdBy: userId,
      });
      await tx.insert(salesLines).values({
        invoiceId: saleId,
        position: 1,
        productId,
        qty: 20 + i,
        unitPrice: rupiah(200000),
        unitCost: rupiah(150000),
        lineTotal: total,
      });
      await movement(day, -(20 + i), "sale", "sales_invoice", saleId);
      await tx.insert(purchaseInvoices).values({
        id: purchaseId,
        number: `DEMO-PO-${i}`,
        supplierId,
        date: day,
        dueDate: addDays(day, 15),
        termsDays: 15,
        subtotal: purchaseTotal,
        total: purchaseTotal,
        discountAmount: rupiah(0),
        createdBy: userId,
      });
      await tx.insert(purchaseLines).values({
        invoiceId: purchaseId,
        position: 1,
        productId,
        qty: 30 + i,
        unitCost: rupiah(150000),
        lineTotal: purchaseTotal,
      });
      await movement(day, 30 + i, "purchase", "purchase_invoice", purchaseId);
      for (const direction of ["receivable", "payable"] as const) {
        const id = uuidv7(),
          amount = direction === "receivable" ? 1000000 : 2000000;
        await tx.insert(payments).values({
          id,
          direction,
          salesInvoiceId: direction === "receivable" ? saleId : null,
          purchaseInvoiceId: direction === "payable" ? purchaseId : null,
          accountId: cashId,
          date: day,
          amount: rupiah(amount),
          method: "cash",
          createdBy: userId,
        });
        await cash(
          day,
          direction === "receivable" ? "in" : "out",
          amount,
          direction === "receivable" ? "sales_payment" : "purchase_payment",
          id,
          direction === "receivable" ? "sale" : "purchase",
        );
      }
      await tx.insert(posSales).values({
        id: posId,
        number: `DEMO-K1-${i}`,
        deviceCode: "DEMO",
        soldAt: new Date(`${day}T03:00:00Z`),
        date: day,
        cashierId: userId,
        subtotal: posTotal,
        total: posTotal,
        discountAmount: rupiah(0),
        method: "cash",
        accountId: cashId,
        tendered: posTotal,
        change: rupiah(0),
      });
      await tx.insert(posLines).values({
        saleId: posId,
        position: 1,
        productId,
        qty: 5 + i,
        unitPrice: rupiah(200000),
        unitCost: rupiah(150000),
        lineTotal: posTotal,
      });
      await movement(day, -(5 + i), "pos", "pos_sale", posId);
      await cash(day, "in", posTotal, "pos_sale", posId, "sale");
      await tx.insert(expenses).values({
        id: expenseId,
        number: `DEMO-BY-${i}`,
        date: day,
        accountId: cashId,
        category: "Operasional",
        description: "Listrik toko contoh",
        amount: rupiah(250000),
        createdBy: userId,
      });
      await cash(day, "out", 250000, "expense", expenseId, "expense");
      if (i === 0) {
        const paymentId = uuidv7();
        const voided = {
          voidedAt: new Date(`${day}T05:00:00Z`),
          voidedBy: userId,
          voidReason: "Koreksi data contoh",
        };
        await tx.insert(payments).values({
          id: paymentId,
          direction: "receivable",
          salesInvoiceId: saleId,
          accountId: cashId,
          date: day,
          amount: rupiah(500000),
          method: "cash",
          createdBy: userId,
          ...voided,
        });
        await cash(day, "in", 500000, "sales_payment", paymentId, "sale");
        await cash(day, "out", 500000, "sales_payment", paymentId, "reversal");
      }
    }
    const voided = {
      voidedAt: new Date(`${date}T05:00:00Z`),
      voidedBy: userId,
      voidReason: "Koreksi data contoh",
    };
    const voidSaleId = uuidv7(),
      voidPosId = uuidv7(),
      voidPurchaseId = uuidv7(),
      voidExpenseId = uuidv7();
    await tx.insert(salesInvoices).values({
      id: voidSaleId,
      number: "DEMO-SO-VOID",
      customerId,
      date,
      dueDate: date,
      subtotal: rupiah(600000),
      total: rupiah(600000),
      discountAmount: rupiah(0),
      createdBy: userId,
      ...voided,
    });
    await tx.insert(salesLines).values({
      invoiceId: voidSaleId,
      position: 1,
      productId,
      qty: 3,
      unitPrice: rupiah(200000),
      unitCost: rupiah(150000),
      lineTotal: rupiah(600000),
    });
    await movement(date, -3, "sale", "sales_invoice", voidSaleId);
    await movement(date, 3, "reversal", "sales_invoice", voidSaleId);
    await tx.insert(purchaseInvoices).values({
      id: voidPurchaseId,
      number: "DEMO-PO-VOID",
      supplierId,
      date,
      dueDate: date,
      subtotal: rupiah(450000),
      total: rupiah(450000),
      discountAmount: rupiah(0),
      createdBy: userId,
      ...voided,
    });
    await tx.insert(purchaseLines).values({
      invoiceId: voidPurchaseId,
      position: 1,
      productId,
      qty: 3,
      unitCost: rupiah(150000),
      lineTotal: rupiah(450000),
    });
    await movement(date, 3, "purchase", "purchase_invoice", voidPurchaseId);
    await movement(date, -3, "reversal", "purchase_invoice", voidPurchaseId);
    await tx.insert(posSales).values({
      id: voidPosId,
      number: "DEMO-K1-VOID",
      deviceCode: "DEMO",
      soldAt: new Date(`${date}T03:00:00Z`),
      date,
      cashierId: userId,
      subtotal: rupiah(600000),
      total: rupiah(600000),
      discountAmount: rupiah(0),
      method: "cash",
      accountId: cashId,
      tendered: rupiah(600000),
      change: rupiah(0),
      ...voided,
    });
    await tx.insert(posLines).values({
      saleId: voidPosId,
      position: 1,
      productId,
      qty: 3,
      unitPrice: rupiah(200000),
      unitCost: rupiah(150000),
      lineTotal: rupiah(600000),
    });
    await movement(date, -3, "pos", "pos_sale", voidPosId);
    await movement(date, 3, "reversal", "pos_sale", voidPosId);
    await cash(date, "in", 600000, "pos_sale", voidPosId, "sale");
    await cash(date, "out", 600000, "pos_sale", voidPosId, "reversal");
    await tx.insert(expenses).values({
      id: voidExpenseId,
      number: "DEMO-BY-VOID",
      date,
      accountId: cashId,
      category: "Operasional",
      amount: rupiah(100000),
      createdBy: userId,
      ...voided,
    });
    await cash(date, "out", 100000, "expense", voidExpenseId, "expense");
    await cash(date, "in", 100000, "expense", voidExpenseId, "reversal");
    for (const isVoid of [false, true]) {
      const id = uuidv7(),
        amount = isVoid ? 2000000 : 3000000;
      await tx.insert(transfers).values({
        id,
        date,
        fromAccountId: cashId,
        toAccountId: bankId,
        amount: rupiah(amount),
        createdBy: userId,
        ...(isVoid ? voided : {}),
      });
      await cash(date, "out", amount, "transfer", id, "transfer");
      await cash(date, "in", amount, "transfer", id, "transfer", bankId);
      if (isVoid) {
        await cash(date, "in", amount, "transfer", id, "reversal");
        await cash(date, "out", amount, "transfer", id, "reversal", bankId);
      }
    }
    const negativeId = uuidv7();
    await tx.insert(products).values({
      id: negativeId,
      code: "DEMO-NEG",
      name: "Kuas Langit 3 inci",
      unit: "pcs",
      minStock: 5,
    });
    await movement(date, -2, "adjustment", null, null, negativeId);
    return { inserted: true, cashId, bankId, customerId, productId };
  });
}
