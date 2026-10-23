import { PrismaClient, type Prisma } from "@prisma/client";
import { nextPurchaseStatus } from "./procurement";

export type ReceivingInput = {
  requestId: string;
  supplierName: string;
  reference: string;
  receivedById: string;
  purchaseOrderId?: string | null;
  lines: { productId: string; quantity: number; unitCostCents: number }[];
};
type Receipt = Prisma.InventoryReceiptGetPayload<{ include: { lines: true } }>;

export class InventoryFailure extends Error {
  constructor(public readonly code:
    "INVALID_LINES" | "INVALID_PRODUCT" | "STOCK_OVERFLOW" | "REQUEST_CONFLICT" | "RETRY_LATER" | "STOCK_CHANGED" | "ORDER_NOT_FOUND" | "ORDER_NOT_RECEIVABLE" |
    "ORDER_SUPPLIER_MISMATCH" | "ORDER_LINE_CONFLICT") {
    super(code);
    this.name = "InventoryFailure";
  }
}
function isConflict(err: unknown) {
  return typeof err === "object" && err !== null &&
    "code" in err && ["P2002", "P2034", "P1008"].includes(String(err.code));
}
export function normalizeReceivingLines(lines: ReceivingInput["lines"]) {
  if (!lines.length || lines.length > 40) throw new InventoryFailure("INVALID_LINES");
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line.productId || seen.has(line.productId) ||
      !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 100000 ||
      !Number.isSafeInteger(line.unitCostCents) || line.unitCostCents < 0 ||
      line.unitCostCents > 100000000) throw new InventoryFailure("INVALID_LINES");
    seen.add(line.productId);
  }
  return lines;
}
export function matchesReceipt(receipt: Receipt, input: ReceivingInput): boolean {
  if (receipt.supplierName !== input.supplierName || receipt.reference !== input.reference ||
    receipt.receivedById !== input.receivedById ||
    (receipt.purchaseOrderId ?? null) !== (input.purchaseOrderId ?? null) ||
    receipt.lines.length !== input.lines.length) return false;
  const byProduct = new Map(input.lines.map(line => [line.productId, line]));
  return receipt.lines.every(line => {
    const request = byProduct.get(line.productId);
    return !!request && request.quantity === line.quantity && request.unitCostCents === line.unitCostCents;
  });
}
export async function receiveInventory(db: PrismaClient, input: ReceivingInput) {
  normalizeReceivingLines(input.lines);
  if (input.supplierName.trim() !== input.supplierName || input.reference.trim() !== input.reference ||
    input.supplierName.length < 2 || input.supplierName.length > 100 ||
    input.reference.length < 2 || input.reference.length > 80) throw new InventoryFailure("INVALID_LINES");

  const lookup = () => db.inventoryReceipt.findUnique({
    where: { requestId: input.requestId }, include: { lines: true }
  });
  const replay = (existing: Receipt) => {
    if (!matchesReceipt(existing, input)) throw new InventoryFailure("REQUEST_CONFLICT");
    return { receipt: existing, replay: true };
  };

  try {
    return await db.$transaction(async tx => {
      const existing = await tx.inventoryReceipt.findUnique({
        where: { requestId: input.requestId }, include: { lines: true }
      });
      if (existing) return replay(existing);

      // The purchase order, line counters, received stock and receipt record
      // must all commit together. A replay above must return before status checks
      // so a successful final delivery is still safely replayable after closure.
      if (input.purchaseOrderId) {
        const order = await tx.purchaseOrder.findUnique({
          where: { id: input.purchaseOrderId },
          include: { supplier: true, lines: true }
        });
        if (!order) throw new InventoryFailure("ORDER_NOT_FOUND");
        if (!["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status)) {
          throw new InventoryFailure("ORDER_NOT_RECEIVABLE");
        }
        if (order.supplier.name !== input.supplierName) {
          throw new InventoryFailure("ORDER_SUPPLIER_MISMATCH");
        }
        const orderLines = new Map(order.lines.map(line => [line.productId, line]));
        const increments = new Map(input.lines.map(line => [line.productId, line.quantity]));
        for (const line of input.lines) {
          const ordered = orderLines.get(line.productId);
          if (!ordered || line.quantity > ordered.quantityOrdered - ordered.quantityReceived) {
            throw new InventoryFailure("ORDER_LINE_CONFLICT");
          }
          const changed = await tx.purchaseOrderLine.updateMany({
            where: {
              id: ordered.id,
              quantityReceived: { lte: ordered.quantityOrdered - line.quantity }
            },
            data: { quantityReceived: { increment: line.quantity } }
          });
          if (changed.count !== 1) throw new InventoryFailure("ORDER_LINE_CONFLICT");
        }
        const nextStatus = nextPurchaseStatus(order.lines.map(line => ({
          quantityOrdered: line.quantityOrdered,
          quantityReceived: line.quantityReceived + (increments.get(line.productId) ?? 0)
        })));
        const shifted = await tx.purchaseOrder.updateMany({
          where: { id: order.id, status: order.status },
          data: { status: nextStatus }
        });
        if (shifted.count !== 1) throw new InventoryFailure("ORDER_NOT_RECEIVABLE");
      }

      const products = await tx.product.findMany({
        where: { id: { in: input.lines.map(line => line.productId) }, isActive: true }
      });
      if (products.length !== input.lines.length) throw new InventoryFailure("INVALID_PRODUCT");
      const byId = new Map(products.map(p => [p.id, p]));
      for (const line of input.lines) {
        const available = byId.get(line.productId);
        if (!available) throw new InventoryFailure("INVALID_PRODUCT");
        const changed = await tx.product.updateMany({
          where: { id: line.productId, isActive: true,
            stockQty: { lte: 1000000 - line.quantity } },
          data: { stockQty: { increment: line.quantity }, costCents: line.unitCostCents }
        });
        if (changed.count !== 1) throw new InventoryFailure("STOCK_OVERFLOW");
      }
      const receipt = await tx.inventoryReceipt.create({
        data: {
          requestId: input.requestId, supplierName: input.supplierName,
          reference: input.reference, receivedById: input.receivedById,
          purchaseOrderId: input.purchaseOrderId ?? null,
          lines: { create: input.lines.map(line => ({
            productId: line.productId, productName: byId.get(line.productId)!.name,
            quantity: line.quantity, unitCostCents: line.unitCostCents
          })) }
        },
        include: { lines: true }
      });
      await tx.stockMovement.createMany({
        data: input.lines.map(line => ({
          productId: line.productId, changeQty: line.quantity,
          reason: "PURCHASE_RECEIVING", reference: receipt.id
        }))
      });
      return { receipt, replay: false };
    }, { maxWait: 5000, timeout: 10000 });
  } catch (err) {
    if (err instanceof InventoryFailure) throw err;
    if (isConflict(err)) {
      try {
        const existing = await lookup();
        if (existing) return replay(existing);
      } catch (lookupError) {
        if (lookupError instanceof InventoryFailure) throw lookupError;
      }
      throw new InventoryFailure("RETRY_LATER");
    }
    throw err;
  }
}

/** Optimistic physical count; never overwrite a stock level changed by a sale. */
export async function reconcileStockCount(db: PrismaClient, input: {
  productId: string; expectedQty: number; countedQty: number; reason: string;
}) {
  const { productId, expectedQty, countedQty, reason } = input;
  if (!productId || !Number.isSafeInteger(expectedQty) || !Number.isSafeInteger(countedQty) ||
    expectedQty < 0 || countedQty < 0 || countedQty > 1000000 ||
    reason.trim().length < 3 || reason.trim().length > 120) throw new InventoryFailure("INVALID_LINES");
  return db.$transaction(async tx => {
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product?.isActive) throw new InventoryFailure("INVALID_PRODUCT");
    if (product.stockQty !== expectedQty) throw new InventoryFailure("STOCK_CHANGED");
    const delta = countedQty - expectedQty;
    if (delta === 0) return { product, delta: 0 };
    const updated = await tx.product.updateMany({
      where: { id: productId, isActive: true, stockQty: expectedQty },
      data: { stockQty: countedQty }
    });
    if (updated.count !== 1) throw new InventoryFailure("STOCK_CHANGED");
    await tx.stockMovement.create({
      data: { productId, changeQty: delta, reason: "STOCK_COUNT", reference: reason.trim() }
    });
    return { product: await tx.product.findUniqueOrThrow({ where: { id: productId } }), delta };
  });
}


// Only manager/owner inventory adjustments call this audited, retry-safe service.
// Receiving, sales, returns and physical counts retain their own workflows.
export type AdjustmentInput = {
  requestId: string; productId: string; expectedQty: number; delta: number;
  reason: "FOUND" | "LOSS" | "DAMAGE" | "CORRECTION";
  note: string; performedById: string;
};
export class StockAdjustmentFailure extends Error {
  constructor(public readonly code: "INVALID_ADJUSTMENT" | "PRODUCT_UNAVAILABLE" |
    "STOCK_CHANGED" | "REQUEST_CONFLICT" | "RETRY_LATER") {
    super(code);
    this.name = "StockAdjustmentFailure";
  }
}
export function validateAdjustment(input: AdjustmentInput) {
  if (!input.productId || !input.performedById ||
    !Number.isSafeInteger(input.expectedQty) || input.expectedQty < 0 ||
    input.expectedQty > 1_000_000 || !Number.isSafeInteger(input.delta) ||
    input.delta === 0 || Math.abs(input.delta) > 100_000 ||
    !["FOUND", "LOSS", "DAMAGE", "CORRECTION"].includes(input.reason) ||
    (input.reason === "FOUND" && input.delta < 0) ||
    (["LOSS", "DAMAGE"].includes(input.reason) && input.delta > 0) ||
    input.note.trim() !== input.note || input.note.length < 4 || input.note.length > 160 ||
    input.expectedQty + input.delta < 0 || input.expectedQty + input.delta > 1_000_000) {
    throw new StockAdjustmentFailure("INVALID_ADJUSTMENT");
  }
}
export async function adjustInventoryStock(db: PrismaClient, input: AdjustmentInput) {
  validateAdjustment(input);
  const exactReplay = (existing: {
    productId: string; beforeQty: number | null; afterQty: number | null;
    changeQty: number; reason: string; note: string | null; performedById: string | null;
  }) => {
    if (existing.productId !== input.productId || existing.beforeQty !== input.expectedQty ||
      existing.afterQty !== input.expectedQty + input.delta ||
      existing.changeQty !== input.delta || existing.reason !== "ADJUST_" + input.reason ||
      existing.note !== input.note || existing.performedById !== input.performedById) {
      throw new StockAdjustmentFailure("REQUEST_CONFLICT");
    }
  };
  try {
    return await db.$transaction(async tx => {
      const prior = await tx.stockMovement.findUnique({ where: { requestId: input.requestId } });
      if (prior) {
        exactReplay(prior);
        return { movement: prior, replay: true };
      }
      const product = await tx.product.findUnique({ where: { id: input.productId } });
      if (!product?.isActive) throw new StockAdjustmentFailure("PRODUCT_UNAVAILABLE");
      const updated = await tx.product.updateMany({
        where: { id: input.productId, isActive: true, stockQty: input.expectedQty },
        data: { stockQty: { increment: input.delta } }
      });
      if (updated.count !== 1) throw new StockAdjustmentFailure("STOCK_CHANGED");
      const movement = await tx.stockMovement.create({
        data: {
          productId: input.productId,
          changeQty: input.delta,
          reason: "ADJUST_" + input.reason,
          requestId: input.requestId,
          beforeQty: input.expectedQty,
          afterQty: input.expectedQty + input.delta,
          performedById: input.performedById,
          note: input.note,
          reference: input.note
        }
      });
      return { movement, replay: false };
    }, { maxWait: 5000, timeout: 10000 });
  } catch (error) {
    if (error instanceof StockAdjustmentFailure) throw error;
    if (isConflict(error)) {
      try {
        const prior = await db.stockMovement.findUnique({ where: { requestId: input.requestId } });
        if (prior) {
          exactReplay(prior);
          return { movement: prior, replay: true };
        }
      } catch (lookupError) {
        if (lookupError instanceof StockAdjustmentFailure) throw lookupError;
      }
      throw new StockAdjustmentFailure("RETRY_LATER");
    }
    throw error;
  }
}
