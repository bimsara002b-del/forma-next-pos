import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { sumLines } from "./money";
import { DEMO_REGISTER_ID } from "./shifts";

export type CheckoutInput = {
  requestId: string;
  receivedCents: number;
  items: { productId: string; quantity: number }[];
};
type StoredSale = Prisma.SaleGetPayload<{ include: { items: true } }>;

export class CheckoutFailure extends Error {
  constructor(public readonly code: "QUANTITY_LIMIT" | "PAYMENT_SHORT" | "PRODUCT_UNAVAILABLE" |
    "STOCK_CHANGED" | "TOTAL_EXCEEDED" | "REQUEST_CONFLICT" | "RETRY_LATER" | "SHIFT_REQUIRED") {
    super(code);
    this.name = "CheckoutFailure";
  }
}

export function normalizeItems(items: CheckoutInput["items"]): Map<string, number> {
  const normalized = new Map<string, number>();
  for (const item of items) {
    // Route schema also validates inputs. This protects the domain service itself.
    if (!item.productId || !Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new CheckoutFailure("QUANTITY_LIMIT");
    }
    const quantity = (normalized.get(item.productId) ?? 0) + item.quantity;
    if (quantity > 1000) throw new CheckoutFailure("QUANTITY_LIMIT");
    normalized.set(item.productId, quantity);
  }
  if (normalized.size === 0 || normalized.size > 100) throw new CheckoutFailure("QUANTITY_LIMIT");
  return normalized;
}

/**
 * An idempotency key means the *same checkout request*, not simply a lookup
 * of any old sale sharing that key. Never return a previous receipt for an
 * altered cart or cash tender.
 */
export function matchesCheckout(sale: StoredSale, quantities: Map<string, number>, receivedCents: number): boolean {
  if (sale.receivedCents !== receivedCents || sale.paymentMethod !== "CASH" || sale.items.length !== quantities.size) return false;
  return sale.items.every(line => quantities.get(line.productId) === line.quantity);
}

function isPrismaCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === code;
}

export async function commitCashCheckout(db: PrismaClient, input: CheckoutInput):
  Promise<{ sale: StoredSale; replay: boolean }> {
  const quantities = normalizeItems(input.items);
  if (!Number.isSafeInteger(input.receivedCents) || input.receivedCents < 0 || input.receivedCents > 2_000_000_000) {
    throw new CheckoutFailure("PAYMENT_SHORT");
  }

  const lookup = () => db.sale.findUnique({
    where: { requestId: input.requestId },
    include: { items: true }
  });
  const resolveExisting = (existing: StoredSale) => {
    if (!matchesCheckout(existing, quantities, input.receivedCents)) {
      throw new CheckoutFailure("REQUEST_CONFLICT");
    }
    return { sale: existing, replay: true };
  };

  try {
    return await db.$transaction(async tx => {
      const existing = await tx.sale.findUnique({
        where: { requestId: input.requestId },
        include: { items: true }
      });
      if (existing) return resolveExisting(existing);

      const register = await tx.cashRegister.findUnique({ where: { id: DEMO_REGISTER_ID } });
      const openShift = register?.activeShiftId
        ? await tx.cashShift.findUnique({ where: { id: register.activeShiftId } })
        : null;
      if (process.env.POS_REQUIRE_OPEN_SHIFT === "true" && (!openShift || openShift.status !== "OPEN")) {
        throw new CheckoutFailure("SHIFT_REQUIRED");
      }
      const shiftId = openShift?.status === "OPEN" ? openShift.id : null;
      const products = await tx.product.findMany({
        where: { id: { in: [...quantities.keys()] }, isActive: true }
      });
      if (products.length !== quantities.size) throw new CheckoutFailure("PRODUCT_UNAVAILABLE");

      const lines = products.map(product => {
        const quantity = quantities.get(product.id)!;
        if (!Number.isSafeInteger(product.priceCents) || product.priceCents <= 0) {
          throw new CheckoutFailure("TOTAL_EXCEEDED");
        }
        return {
          productId: product.id,
          productName: product.name,
          quantity,
          unitPriceCents: product.priceCents,
          lineTotalCents: product.priceCents * quantity,
          unitCostCents: product.costCents > 0 ? product.costCents : null,
          lineCostCents: product.costCents > 0 ? product.costCents * quantity : null
        };
      });
      let totalCents: number;
      try {
        totalCents = sumLines(lines);
      } catch {
        throw new CheckoutFailure("TOTAL_EXCEEDED");
      }
      if (input.receivedCents < totalCents) throw new CheckoutFailure("PAYMENT_SHORT");

      for (const line of lines) {
        const result = await tx.product.updateMany({
          where: { id: line.productId, isActive: true, stockQty: { gte: line.quantity } },
          data: { stockQty: { decrement: line.quantity } }
        });
        if (result.count !== 1) throw new CheckoutFailure("STOCK_CHANGED");
      }

      const sale = await tx.sale.create({
        data: {
          requestId: input.requestId,
          receiptNumber: "FP-" + new Date().toISOString().slice(0, 10).replaceAll("-", "") +
            "-" + randomUUID().slice(0, 8).toUpperCase(),
          totalCents,
          receivedCents: input.receivedCents,
          changeCents: input.receivedCents - totalCents,
          paymentMethod: "CASH",
          shiftId,
          items: { create: lines }
        },
        include: { items: true }
      });
      await tx.stockMovement.createMany({
        data: lines.map(line => ({
          productId: line.productId, changeQty: -line.quantity,
          reason: "SALE", reference: sale.receiptNumber
        }))
      });
      return { sale, replay: false };
    }, { maxWait: 5000, timeout: 10000 });
  } catch (error) {
    if (error instanceof CheckoutFailure) throw error;
    // A concurrent retry may complete between our lookup and insert.
    if (["P2002", "P2034", "P1008"].some(code => isPrismaCode(error, code))) {
      try {
        const existing = await lookup();
        if (existing) return resolveExisting(existing);
      } catch (lookupError) {
        if (lookupError instanceof CheckoutFailure) throw lookupError;
      }
      throw new CheckoutFailure("RETRY_LATER");
    }
    throw error;
  }
}
