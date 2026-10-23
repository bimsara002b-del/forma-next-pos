import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { DEMO_REGISTER_ID, expectedCash } from "./shifts";

export type ReturnInput = {
  requestId: string;
  saleId: string;
  reason: string;
  approvedById: string;
  lines: { saleItemId: string; quantity: number; restock: boolean }[];
};
type StoredReturn = Prisma.SaleReturnGetPayload<{ include: { lines: true } }>;

export class ReturnFailure extends Error {
  constructor(public readonly code:
    "INVALID_RETURN" | "SALE_NOT_FOUND" | "NOT_CASH_SALE" | "LINE_NOT_FOUND" |
    "ALREADY_RETURNED" | "REFUND_OVERFLOW" | "RESTOCK_UNAVAILABLE" |
    "NO_OPEN_SHIFT" | "INSUFFICIENT_DRAWER_CASH" | "REQUEST_CONFLICT" | "RETRY_LATER") {
    super(code);
    this.name = "ReturnFailure";
  }
}
function isPrismaConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    ["P2002", "P2034", "P1008"].includes(String(error.code));
}
export function validateReturnLines(lines: ReturnInput["lines"]): void {
  if (!lines.length || lines.length > 100) throw new ReturnFailure("INVALID_RETURN");
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line.saleItemId || seen.has(line.saleItemId) ||
      !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 1000 ||
      typeof line.restock !== "boolean") throw new ReturnFailure("INVALID_RETURN");
    seen.add(line.saleItemId);
  }
}
export function matchesReturn(original: StoredReturn, input: ReturnInput): boolean {
  if (original.saleId !== input.saleId || original.reason !== input.reason ||
      original.approvedById !== input.approvedById || original.lines.length !== input.lines.length) return false;
  const received = new Map(input.lines.map(line => [line.saleItemId, line]));
  return original.lines.every(line => {
    const requested = received.get(line.saleItemId);
    return !!requested && line.quantity === requested.quantity && line.restocked === requested.restock;
  });
}
export function calculateRefund(lines: { quantity: number; unitPriceCents: number }[]): number {
  const amount = lines.reduce((total, line) => total + line.quantity * line.unitPriceCents, 0);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 2_000_000_000) {
    throw new ReturnFailure("REFUND_OVERFLOW");
  }
  return amount;
}

/**
 * Manager-confirmed MANUAL cash refund recording, not a payment-gateway transfer.
 * The returnedQty cap, restock ledger, cash drawer movement and return receipt
 * are committed in ONE database transaction. A cash shift is mandatory.
 */
export async function postCashReturn(db: PrismaClient, input: ReturnInput):
  Promise<{ returnRecord: StoredReturn; replay: boolean }> {
  validateReturnLines(input.lines);
  if (input.reason.trim() !== input.reason || input.reason.length < 4 || input.reason.length > 160 ||
    !input.saleId || !input.approvedById) throw new ReturnFailure("INVALID_RETURN");
  const findExisting = () => db.saleReturn.findUnique({
    where: { requestId: input.requestId }, include: { lines: true }
  });
  const replay = (existing: StoredReturn) => {
    if (!matchesReturn(existing, input)) throw new ReturnFailure("REQUEST_CONFLICT");
    return { returnRecord: existing, replay: true };
  };
  try {
    return await db.$transaction(async tx => {
      const existing = await tx.saleReturn.findUnique({
        where: { requestId: input.requestId }, include: { lines: true }
      });
      if (existing) return replay(existing);

      const sale = await tx.sale.findUnique({
        where: { id: input.saleId }, include: { items: true }
      });
      if (!sale) throw new ReturnFailure("SALE_NOT_FOUND");
      if (sale.paymentMethod !== "CASH") throw new ReturnFailure("NOT_CASH_SALE");

      const savedItems = new Map(sale.items.map(item => [item.id, item]));
      const selected = input.lines.map(line => {
        const original = savedItems.get(line.saleItemId);
        if (!original) throw new ReturnFailure("LINE_NOT_FOUND");
        if (line.quantity > original.quantity - original.returnedQty) {
          throw new ReturnFailure("ALREADY_RETURNED");
        }
        return { ...line, original };
      });
      const refundCents = calculateRefund(selected.map(line => ({
        quantity: line.quantity, unitPriceCents: line.original.unitPriceCents
      })));

      const register = await tx.cashRegister.findUnique({
        where: { id: DEMO_REGISTER_ID }
      });
      if (!register?.activeShiftId) throw new ReturnFailure("NO_OPEN_SHIFT");
      const shift = await tx.cashShift.findUnique({
        where: { id: register.activeShiftId }
      });
      if (!shift || shift.status !== "OPEN") throw new ReturnFailure("NO_OPEN_SHIFT");

      // The write lock/compare-and-swap keeps a concurrent shift close from
      // observing a half-applied refund in the SQLite demo transaction.
      const shiftGuard = await tx.cashShift.updateMany({
        where: { id: shift.id, status: "OPEN" },
        data: { status: "OPEN" }
      });
      if (shiftGuard.count !== 1) throw new ReturnFailure("NO_OPEN_SHIFT");

      const [grossSales, drawerMovements] = await Promise.all([
        tx.sale.aggregate({
          where: { shiftId: shift.id, paymentMethod: "CASH" },
          _sum: { totalCents: true }
        }),
        tx.cashMovement.aggregate({
          where: { shiftId: shift.id },
          _sum: { changeCents: true }
        })
      ]);
      const cashAvailable = expectedCash(
        shift.openingFloatCents,
        grossSales._sum.totalCents ?? 0,
        drawerMovements._sum.changeCents ?? 0
      );
      if (cashAvailable < refundCents) throw new ReturnFailure("INSUFFICIENT_DRAWER_CASH");

      for (const line of selected) {
        const itemResult = await tx.saleItem.updateMany({
          where: {
            id: line.original.id, saleId: sale.id,
            returnedQty: { lte: line.original.quantity - line.quantity }
          },
          data: { returnedQty: { increment: line.quantity } }
        });
        if (itemResult.count !== 1) throw new ReturnFailure("ALREADY_RETURNED");
        if (line.restock) {
          const productResult = await tx.product.updateMany({
            where: {
              id: line.original.productId,
              isActive: true,
              stockQty: { lte: 1_000_000 - line.quantity }
            },
            data: { stockQty: { increment: line.quantity } }
          });
          if (productResult.count !== 1) throw new ReturnFailure("RESTOCK_UNAVAILABLE");
        }
      }

      const record = await tx.saleReturn.create({
        data: {
          requestId: input.requestId,
          returnNumber: "RET-" + randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(),
          saleId: sale.id, shiftId: shift.id, reason: input.reason,
          approvedById: input.approvedById, refundCents,
          lines: { create: selected.map(line => ({
            saleItemId: line.original.id,
            quantity: line.quantity,
            unitPriceCents: line.original.unitPriceCents,
            refundCents: line.original.unitPriceCents * line.quantity,
            restocked: line.restock
          })) }
        }, include: { lines: true }
      });
      await tx.cashMovement.create({
        data: {
          requestId: "return:" + input.requestId,
          shiftId: shift.id,
          type: "REFUND",
          changeCents: -refundCents,
          recordedById: input.approvedById,
          note: "Refund " + record.returnNumber
        }
      });
      const restocked = selected.filter(line => line.restock);
      if (restocked.length) {
        await tx.stockMovement.createMany({
          data: restocked.map(line => ({
            productId: line.original.productId,
            changeQty: line.quantity,
            reason: "CUSTOMER_RETURN",
            reference: record.returnNumber
          }))
        });
      }
      return { returnRecord: record, replay: false };
    }, { maxWait: 5000, timeout: 10000 });
  } catch (error) {
    if (error instanceof ReturnFailure) throw error;
    if (isPrismaConflict(error)) {
      try {
        const existing = await findExisting();
        if (existing) return replay(existing);
      } catch (lookupError) {
        if (lookupError instanceof ReturnFailure) throw lookupError;
      }
      throw new ReturnFailure("RETRY_LATER");
    }
    throw error;
  }
}
