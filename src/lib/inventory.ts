import { PrismaClient, type Prisma } from "@prisma/client";

export type ReceivingInput = {
  requestId: string;
  supplierName: string;
  reference: string;
  receivedById: string;
  lines: { productId: string; quantity: number; unitCostCents: number }[];
};
type Receipt = Prisma.InventoryReceiptGetPayload<{ include: { lines: true } }>;

export class InventoryFailure extends Error {
  constructor(public readonly code:
    "INVALID_LINES" | "INVALID_PRODUCT" | "STOCK_OVERFLOW" | "REQUEST_CONFLICT" | "RETRY_LATER" | "STOCK_CHANGED") {
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
    receipt.receivedById !== input.receivedById || receipt.lines.length !== input.lines.length) return false;
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
