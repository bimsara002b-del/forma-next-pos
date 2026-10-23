import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { InventoryFailure, matchesReceipt, normalizeReceivingLines,
  receiveInventory, reconcileStockCount, adjustInventoryStock, StockAdjustmentFailure } from "../src/lib/inventory";

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
    await db.purchaseOrderLine.deleteMany();
    await db.purchaseOrder.deleteMany();
    await db.supplier.deleteMany();
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


  test("PO partial and final receiving updates PO counters, stock and ledger atomically",async()=>{
    const p=await product(2);
    const supplier=await db!.supplier.create({data:{name:"Supplier "+randomUUID()}});
    const po=await db!.purchaseOrder.create({data:{
      orderNumber:"PO-"+randomUUID(),supplierId:supplier.id,createdById:"owner",status:"ORDERED",
      lines:{create:[{productId:p.id,quantityOrdered:10,unitCostCents:250}]}
    }});
    const payload={...receipt([{productId:p.id,quantity:4,unitCostCents:250}]),
      supplierName:supplier.name,purchaseOrderId:po.id};
    const first=await receiveInventory(db!,payload);
    expect(first.replay).toBe(false);
    expect((await db!.purchaseOrder.findUniqueOrThrow({where:{id:po.id}})).status).toBe("PARTIALLY_RECEIVED");
    expect((await db!.purchaseOrderLine.findFirstOrThrow({where:{purchaseOrderId:po.id}})).quantityReceived).toBe(4);
    const repeat=await receiveInventory(db!,payload);
    expect(repeat.replay).toBe(true);
    await expect(receiveInventory(db!,{...receipt([{productId:p.id,quantity:7,unitCostCents:250}]),
      supplierName:supplier.name,purchaseOrderId:po.id})).rejects.toMatchObject({code:"ORDER_LINE_CONFLICT"});
    expect((await db!.purchaseOrderLine.findFirstOrThrow({where:{purchaseOrderId:po.id}})).quantityReceived).toBe(4);
    expect((await db!.product.findUniqueOrThrow({where:{id:p.id}})).stockQty).toBe(6);
    const final=await receiveInventory(db!,{...receipt([{productId:p.id,quantity:6,unitCostCents:250}]),
      supplierName:supplier.name,purchaseOrderId:po.id});
    expect(final.replay).toBe(false);
    expect((await db!.purchaseOrder.findUniqueOrThrow({where:{id:po.id}})).status).toBe("RECEIVED");
    expect((await db!.purchaseOrderLine.findFirstOrThrow({where:{purchaseOrderId:po.id}})).quantityReceived).toBe(10);
    expect((await db!.product.findUniqueOrThrow({where:{id:p.id}})).stockQty).toBe(12);
    expect(await db!.stockMovement.count()).toBe(2);
    expect((await db!.inventoryReceipt.findMany({where:{purchaseOrderId:po.id}}))).toHaveLength(2);
  });
  test("rejects supplier mismatch and draft order without receiving any stock",async()=>{
    const p=await product(5);
    const supplier=await db!.supplier.create({data:{name:"Supplier "+randomUUID()}});
    const po=await db!.purchaseOrder.create({data:{
      orderNumber:"PO-"+randomUUID(),supplierId:supplier.id,createdById:"owner",
      lines:{create:[{productId:p.id,quantityOrdered:4,unitCostCents:200}]}
    }});
    const input={...receipt([{productId:p.id,quantity:2,unitCostCents:200}]),purchaseOrderId:po.id};
    await expect(receiveInventory(db!,input)).rejects.toMatchObject({code:"ORDER_NOT_RECEIVABLE"});
    await db!.purchaseOrder.update({where:{id:po.id},data:{status:"ORDERED"}});
    await expect(receiveInventory(db!,input)).rejects.toMatchObject({code:"ORDER_SUPPLIER_MISMATCH"});
    expect((await db!.product.findUniqueOrThrow({where:{id:p.id}})).stockQty).toBe(5);
    expect(await db!.inventoryReceipt.count()).toBe(0);
    expect(await db!.stockMovement.count()).toBe(0);
  });

  test("audited adjustments record before/after and reject stale or duplicate requests",async()=>{
    const p=await product(10);
    const input={ requestId:randomUUID(),productId:p.id,expectedQty:10,delta:-3,
      reason:"DAMAGE" as const,note:"Broken packages",performedById:"manager" };
    const first=await adjustInventoryStock(db!,input);
    expect(first.replay).toBe(false);
    expect(first.movement).toMatchObject({
      beforeQty:10,afterQty:7,changeQty:-3,reason:"ADJUST_DAMAGE",performedById:"manager"
    });
    const replay=await adjustInventoryStock(db!,input);
    expect(replay.replay).toBe(true);
    await expect(adjustInventoryStock(db!,{...input,delta:-2})).rejects.toMatchObject({code:"REQUEST_CONFLICT"});
    await expect(adjustInventoryStock(db!,{...input,requestId:randomUUID()})).rejects.toMatchObject({code:"STOCK_CHANGED"});
    expect((await db!.product.findUniqueOrThrow({where:{id:p.id}})).stockQty).toBe(7);
    expect(await db!.stockMovement.count()).toBe(1);
  });

  test("stock adjustments reject negative stock, archived products and invalid directions",async()=>{
    const p=await product(1);
    const base={requestId:randomUUID(),productId:p.id,expectedQty:1,delta:-2,
      reason:"LOSS" as const,note:"Inventory loss",performedById:"owner"};
    await expect(adjustInventoryStock(db!,base)).rejects.toBeInstanceOf(StockAdjustmentFailure);
    await expect(adjustInventoryStock(db!,{...base,delta:1})).rejects.toMatchObject({code:"INVALID_ADJUSTMENT"});
    await db!.product.update({where:{id:p.id},data:{isActive:false}});
    await expect(adjustInventoryStock(db!,{...base,delta:-1})).rejects.toMatchObject({code:"PRODUCT_UNAVAILABLE"});
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
