import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { commitCashCheckout } from "../src/lib/checkout";

// This file NEVER defaults to DATABASE_URL or a developer's live/demo database.
// In CI, prepare a separate local SQLite test file before setting this env.
const url = process.env.POS_TEST_DATABASE_URL;
const isSafeTestDatabase = /^file:\.\/[a-zA-Z0-9_-]*integration\.test\.db$/.test(url ?? "");
const test = isSafeTestDatabase ? it : it.skip;
const db = isSafeTestDatabase
  ? new PrismaClient({ datasources: { db: { url: url! } } })
  : null;

function freshSale(productId: string, requestId = randomUUID(), quantity = 1, receivedCents = 2000) {
  return { requestId, receivedCents, items: [{ productId, quantity }] };
}

async function addProduct(stockQty: number, priceCents = 500) {
  return db!.product.create({
    data: {
      sku: randomUUID(),
      name: "Integration test item",
      priceCents,
      stockQty,
      costCents: 200
    }
  });
}

describe("transactional cash checkout (isolated integration test database)", () => {
  beforeAll(async () => {
    if (db) await db.$connect();
  });
  beforeEach(async () => {
    if (!db) return;
    await db.stockMovement.deleteMany();
    await db.saleItem.deleteMany();
    await db.sale.deleteMany();
    await db.product.deleteMany();
  });
  afterAll(async () => { if (db) await db.$disconnect(); });

  test("posts one sale, one movement and correct change", async () => {
    const p = await addProduct(4, 625);
    const result = await commitCashCheckout(db!, freshSale(p.id, randomUUID(), 2, 2000));
    expect(result.replay).toBe(false);
    expect(result.sale.totalCents).toBe(1250);
    expect(result.sale.changeCents).toBe(750);
    expect(await db!.product.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ stockQty: 2 });
    expect(await db!.stockMovement.findMany()).toHaveLength(1);
    expect((await db!.stockMovement.findFirstOrThrow()).changeQty).toBe(-2);
  });

  test("identical retry reuses receipt with no duplicate deduction", async () => {
    const p = await addProduct(3);
    const request = freshSale(p.id);
    const first = await commitCashCheckout(db!, request);
    const second = await commitCashCheckout(db!, request);
    expect(second.replay).toBe(true);
    expect(second.sale.id).toBe(first.sale.id);
    expect(await db!.sale.count()).toBe(1);
    expect(await db!.stockMovement.count()).toBe(1);
    expect((await db!.product.findUniqueOrThrow({ where: { id: p.id } })).stockQty).toBe(2);
  });

  test("changed cart or cash tender cannot reuse a request ID", async () => {
    const p = await addProduct(10);
    const request = freshSale(p.id);
    await commitCashCheckout(db!, request);
    const q = await addProduct(10);
    await expect(commitCashCheckout(db!, { ...request, receivedCents: 3000 })).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
    await expect(commitCashCheckout(db!, { ...request, items: [{ productId: q.id, quantity: 1 }] })).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
    await expect(commitCashCheckout(db!, { ...request, items: [{ productId: p.id, quantity: 2 }] })).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
    expect(await db!.sale.count()).toBe(1);
    expect(await db!.stockMovement.count()).toBe(1);
  });

  test("insufficient funds and insufficient stock do not partially write", async () => {
    const p = await addProduct(1, 800);
    await expect(commitCashCheckout(db!, freshSale(p.id, randomUUID(), 1, 100))).rejects.toMatchObject({ code: "PAYMENT_SHORT" });
    await expect(commitCashCheckout(db!, freshSale(p.id, randomUUID(), 2))).rejects.toMatchObject({ code: "STOCK_CHANGED" });
    expect(await db!.sale.count()).toBe(0);
    expect(await db!.stockMovement.count()).toBe(0);
    expect((await db!.product.findUniqueOrThrow({ where: { id: p.id } })).stockQty).toBe(1);
  });

  test("aggregates duplicate product lines without double-posting", async () => {
    const p = await addProduct(5);
    const request = {
      requestId: randomUUID(), receivedCents: 2000,
      items: [{ productId: p.id, quantity: 1 }, { productId: p.id, quantity: 2 }]
    };
    const result = await commitCashCheckout(db!, request);
    expect(result.sale.items).toHaveLength(1);
    expect(result.sale.items[0].quantity).toBe(3);
    expect((await db!.product.findUniqueOrThrow({ where: { id: p.id } })).stockQty).toBe(2);
  });

  test("competing checkouts for last unit do not oversell", async () => {
    const p = await addProduct(1);
    const attempts = await Promise.allSettled([
      commitCashCheckout(db!, freshSale(p.id)),
      commitCashCheckout(db!, freshSale(p.id))
    ]);
    const successes = attempts.filter(x => x.status === "fulfilled");
    const failures = attempts.filter(x => x.status === "rejected");
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect((await db!.product.findUniqueOrThrow({ where: { id: p.id } })).stockQty).toBe(0);
    expect(await db!.sale.count()).toBe(1);
    expect(await db!.stockMovement.count()).toBe(1);
  });
});
