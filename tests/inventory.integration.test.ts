import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { InventoryFailure, matchesReceipt, normalizeReceivingLines,
  receiveInventory, reconcileStockCount } from "../src/lib/inventory";

const url = process.env.POS_INVENTORY_TEST_DATABASE_URL;
const validTestUrl = url === "file:./inventory-integration.test.db";
const test = validTestUrl ? it : it.skip;
const db = validTestUrl ? new PrismaClient({ datasources: { db: { url: url! } } }) : null;
async function product(stockQty: number, costCents = 100) {
  return db!.product.create({ data: { sku: randomUUID(), name: "Test Product",
    priceCents: 650, costCents, stockQty } });
}
function receipt(lines: { productId: string; quantity: number; unitCostCents: number }[]) {
  return { requestId: randomUUID(), supplierName: "Example Supplier",
    reference: "INV-0001", receivedById: "local-owner", lines };
}

describe("Advanced inventory isolated SQLite integration", () => {
  beforeAll(async () => { if (db) await db.$connect(); });
  beforeEach(async () => {
    if (!db) return;
    await db.inventoryReceiptLine.deleteMany();
    await db.inventoryReceipt.deleteMany();
    await db.stockMovement.deleteMany();
    await db.saleItem.deleteMany();
    await db.sale.deleteMany();
    await db.product.deleteMany();
  });
  afterAll(async () => { if (db) await db.$disconnect(); });

  test("receives two products atomically with unit cost, linked receipt lines and ledger", async () => {
    const a = await product(3), b = await product(5);
    const result = await receiveInventory(db!, receipt([
      { productId: a.id, quantity: 7, unitCostCents: 230 },
      { productId: b.id, quantity: 4, unitCostCents: 180 }
    ]));
    expect(result.replay).toBe(false);
    expect(result.receipt.lines).toHaveLength(2);
    expect((await db!.product.findUniqueOrThrow({ where: { id: a.id } }))).toMatchObject({
      stockQty: 10, costCents: 230
    });
    expect((await db!.product.findUniqueOrThrow({ where: { id: b.id } }))).toMatchObject({
      stockQty: 9, costCents: 180
    });
    expect(await db!.stockMovement.count({ where: { reason: "PURCHASE_RECEIVING" } })).toBe(2);
  });

  test("identical receipt retry cannot duplicate inventory; changed payload is rejected", async () => {
    const a = await product(3);
    const request = receipt([{ productId: a.id, quantity: 2, unitCostCents: 200 }]);
    const initial = await receiveInventory(db!, request);
    const repeated = await receiveInventory(db!, request);
    expect(repeated.replay).toBe(true);
    expect(repeated.receipt.id).toBe(initial.receipt.id);
    await expect(receiveInventory(db!, { ...request,
      lines: [{ productId: a.id, quantity: 3, unitCostCents: 200 }] })).rejects.toMatchObject({
      code: "REQUEST_CONFLICT"
    });
    await expect(receiveInventory(db!, { ...request, reference: "INV-CHANGED" })).rejects.toMatchObject({
      code: "REQUEST_CONFLICT"
    });
    expect(await db!.inventoryReceipt.count()).toBe(1);
    expect(await db!.stockMovement.count()).toBe(1);
    expect((await db!.product.findUniqueOrThrow({ where: { id: a.id } })).stockQty).toBe(5);
  });

  test("invalid product fails with zero receipt lines and zero stock movement", async () => {
    const a = await product(8);
    const request = receipt([
      { productId: a.id, quantity: 2, unitCostCents: 200 },
      { productId: "missing-product", quantity: 3, unitCostCents: 200 }
    ]);
    await expect(receiveInventory(db!, request)).rejects.toMatchObject({ code: "INVALID_PRODUCT" });
    expect(await db!.inventoryReceipt.count()).toBe(0);
    expect(await db!.stockMovement.count()).toBe(0);
    expect((await db!.product.findUniqueOrThrow({ where: { id: a.id } })).stockQty).toBe(8);
  });

  test("receiving overflow and archived products never change stock", async () => {
    const a = await product(999999), b = await product(2);
    await expect(receiveInventory(db!, receipt([
      { productId: a.id, quantity: 2, unitCostCents: 200 }
    ]))).rejects.toMatchObject({ code: "STOCK_OVERFLOW" });
    await db!.product.update({ where: { id: b.id }, data: { isActive: false } });
    await expect(receiveInventory(db!, receipt([
      { productId: b.id, quantity: 2, unitCostCents: 200 }
    ]))).rejects.toMatchObject({ code: "INVALID_PRODUCT" });
    expect(await db!.stockMovement.count()).toBe(0);
  });

  test("optimistic physical count rejects stale stock and preserves ledger", async () => {
    const a = await product(10);
    const counted = await reconcileStockCount(db!, {
      productId: a.id, expectedQty: 10, countedQty: 8, reason: "End of day count"
    });
    expect(counted.delta).toBe(-2);
    expect((await db!.stockMovement.findFirstOrThrow()).changeQty).toBe(-2);
    await expect(reconcileStockCount(db!, {
      productId: a.id, expectedQty: 10, countedQty: 5, reason: "Stale count"
    })).rejects.toMatchObject({ code: "STOCK_CHANGED" });
    expect((await db!.product.findUniqueOrThrow({ where: { id: a.id } })).stockQty).toBe(8);
    expect(await db!.stockMovement.count()).toBe(1);
    const noChange = await reconcileStockCount(db!, {
      productId: a.id, expectedQty: 8, countedQty: 8, reason: "Confirm counted"
    });
    expect(noChange.delta).toBe(0);
    expect(await db!.stockMovement.count()).toBe(1);
  });
});

describe("Inventory domain validation", () => {
  it("rejects a duplicate product within one receiving document", () => {
    expect(() => normalizeReceivingLines([
      { productId: "p", quantity: 1, unitCostCents: 100 },
      { productId: "p", quantity: 1, unitCostCents: 100 }
    ])).toThrow(InventoryFailure);
    expect(() => normalizeReceivingLines([{ productId: "p", quantity: 0, unitCostCents: 100 }])).toThrow();
    expect(() => normalizeReceivingLines([{ productId: "p", quantity: 1, unitCostCents: -1 }])).toThrow();
  });
  it("accepts same lines in a different order but rejects changed cost", () => {
    const lines = [
      { productId: "a", quantity: 2, unitCostCents: 300 },
      { productId: "b", quantity: 1, unitCostCents: 250 }
    ];
    const record = { supplierName: "Supplier", reference: "Ref", receivedById: "staff",
      lines } as Parameters<typeof matchesReceipt>[0];
    const input = { requestId: randomUUID(), supplierName: "Supplier", reference: "Ref",
      receivedById: "staff", lines: [...lines].reverse() };
    expect(matchesReceipt(record, input)).toBe(true);
    expect(matchesReceipt(record, { ...input,
      lines: [{ productId: "a", quantity: 2, unitCostCents: 100 }, lines[1]] })).toBe(false);
  });
});
