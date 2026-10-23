import type { PrismaClient } from "@prisma/client";

export const DEMO_REGISTER_ID = "REG-01";
const MAX_CENTS = 2_000_000_000;
export type ShiftActor = { id: string; role: "OWNER" | "MANAGER" | "CASHIER"; displayName: string };

export class ShiftFailure extends Error {
  constructor(public readonly code:
    "INVALID_AMOUNT" | "ALREADY_OPEN" | "NO_OPEN_SHIFT" | "NOT_YOUR_SHIFT" |
    "CASH_CONFLICT" | "REQUEST_CONFLICT" | "SHIFT_BUSY") {
    super(code); this.name = "ShiftFailure";
  }
}
export function isValidCents(amount: number) {
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= MAX_CENTS;
}
export function expectedCash(opening: number, sales: number, movements: number) {
  const result = opening + sales + movements;
  if (![opening, sales, movements, result].every(Number.isSafeInteger) || result < 0 || result > MAX_CENTS)
    throw new ShiftFailure("INVALID_AMOUNT");
  return result;
}
export function canManageShift(actor: ShiftActor, openedById: string) {
  return actor.id === openedById || actor.role === "MANAGER" || actor.role === "OWNER";
}
function prismaConflict(error: unknown) {
  return typeof error === "object" && error !== null &&
    "code" in error && ["P2002", "P2034", "P1008"].includes(String(error.code));
}
export async function openCashShift(db: PrismaClient, actor: ShiftActor, floatCents: number) {
  if (!isValidCents(floatCents)) throw new ShiftFailure("INVALID_AMOUNT");
  try {
    return await db.$transaction(async tx => {
      const register = await tx.cashRegister.upsert({
        where: { id: DEMO_REGISTER_ID },
        create: { id: DEMO_REGISTER_ID, displayName: "Local Register 01" },
        update: {}
      });
      if (register.activeShiftId) throw new ShiftFailure("ALREADY_OPEN");
      const shift = await tx.cashShift.create({
        data: { registerId: DEMO_REGISTER_ID, openedById: actor.id,
          openedByName: actor.displayName, openingFloatCents: floatCents }
      });
      const result = await tx.cashRegister.updateMany({
        where: { id: DEMO_REGISTER_ID, activeShiftId: null },
        data: { activeShiftId: shift.id }
      });
      if (result.count !== 1) throw new ShiftFailure("ALREADY_OPEN");
      return shift;
    });
  } catch (error) {
    if (error instanceof ShiftFailure) throw error;
    if (prismaConflict(error)) throw new ShiftFailure("SHIFT_BUSY");
    throw error;
  }
}
async function getActiveRegister(tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) {
  // This helper deliberately operates inside the caller's transaction.
  const register = await tx.cashRegister.findUnique({ where: { id: DEMO_REGISTER_ID } });
  if (!register?.activeShiftId) throw new ShiftFailure("NO_OPEN_SHIFT");
  const shift = await tx.cashShift.findUnique({ where: { id: register.activeShiftId } });
  if (!shift || shift.status !== "OPEN") throw new ShiftFailure("NO_OPEN_SHIFT");
  return shift;
}
export async function closeCashShift(db: PrismaClient, actor: ShiftActor, countedCashCents: number) {
  if (!isValidCents(countedCashCents)) throw new ShiftFailure("INVALID_AMOUNT");
  try {
    return await db.$transaction(async tx => {
      const shift = await getActiveRegister(tx);
      if (!canManageShift(actor, shift.openedById)) throw new ShiftFailure("NOT_YOUR_SHIFT");
      const [sales, movements] = await Promise.all([
        tx.sale.aggregate({ where: { shiftId: shift.id, paymentMethod: "CASH" }, _sum: { totalCents: true } }),
        tx.cashMovement.aggregate({ where: { shiftId: shift.id }, _sum: { changeCents: true } })
      ]);
      const salesCents = sales._sum.totalCents ?? 0;
      const movementCents = movements._sum.changeCents ?? 0;
      const expectedCashCents = expectedCash(shift.openingFloatCents, salesCents, movementCents);
      const changed = await tx.cashShift.updateMany({
        where: { id: shift.id, status: "OPEN" },
        data: { status: "CLOSED", closedById: actor.id,
          countedCashCents, expectedCashCents, varianceCents: countedCashCents - expectedCashCents,
          closedAt: new Date() }
      });
      if (changed.count !== 1) throw new ShiftFailure("SHIFT_BUSY");
      const register = await tx.cashRegister.updateMany({
        where: { id: DEMO_REGISTER_ID, activeShiftId: shift.id },
        data: { activeShiftId: null }
      });
      if (register.count !== 1) throw new ShiftFailure("SHIFT_BUSY");
      return { shiftId: shift.id, countedCashCents, expectedCashCents,
        varianceCents: countedCashCents - expectedCashCents, salesCents, movementCents };
    });
  } catch (error) {
    if (error instanceof ShiftFailure) throw error;
    if (prismaConflict(error)) throw new ShiftFailure("SHIFT_BUSY");
    throw error;
  }
}
export async function addCashMovement(db: PrismaClient, actor: ShiftActor, request: {
  requestId: string; type: "CASH_IN" | "CASH_OUT"; amountCents: number; note: string;
}) {
  if (!isValidCents(request.amountCents) || request.amountCents === 0) throw new ShiftFailure("INVALID_AMOUNT");
  const changeCents = request.type === "CASH_IN" ? request.amountCents : -request.amountCents;
  const resolveReplay = (existing: {
    shiftId: string; changeCents: number; type: string; note: string; recordedById: string;
  }, currentShiftId: string) => {
    if (existing.shiftId !== currentShiftId || existing.changeCents !== changeCents ||
      existing.type !== request.type || existing.note !== request.note ||
      existing.recordedById !== actor.id) throw new ShiftFailure("REQUEST_CONFLICT");
  };
  try {
    return await db.$transaction(async tx => {
      const shift = await getActiveRegister(tx);
      if (!canManageShift(actor, shift.openedById)) throw new ShiftFailure("NOT_YOUR_SHIFT");
      const existing = await tx.cashMovement.findUnique({ where: { requestId: request.requestId } });
      if (existing) {
        resolveReplay(existing, shift.id);
        return { movement: existing, replay: true };
      }
      const movement = await tx.cashMovement.create({
        data: { shiftId: shift.id, requestId: request.requestId, type: request.type,
          changeCents, note: request.note, recordedById: actor.id }
      });
      return { movement, replay: false };
    });
  } catch (error) {
    if (error instanceof ShiftFailure) throw error;
    if (prismaConflict(error)) throw new ShiftFailure("SHIFT_BUSY");
    throw error;
  }
}
export async function shiftOverview(db: PrismaClient) {
  const register = await db.cashRegister.findUnique({ where: { id: DEMO_REGISTER_ID } });
  const active = register?.activeShiftId ? await db.cashShift.findUnique({
    where: { id: register.activeShiftId }
  }) : null;
  const history = await db.cashShift.findMany({
    where: { registerId: DEMO_REGISTER_ID }, orderBy: { openedAt: "desc" }, take: 20
  });
  const activeShift = active?.status === "OPEN" ? active : null;
  if (!activeShift) return { active: null, history };
  const [sales, movements] = await Promise.all([
    db.sale.aggregate({ where: { shiftId: activeShift.id, paymentMethod: "CASH" }, _sum: { totalCents: true } }),
    db.cashMovement.aggregate({ where: { shiftId: activeShift.id }, _sum: { changeCents: true } })
  ]);
  const salesCents = sales._sum.totalCents ?? 0, movementCents = movements._sum.changeCents ?? 0;
  return { active: { ...activeShift, salesCents, movementCents,
    expectedCashCents: expectedCash(activeShift.openingFloatCents, salesCents, movementCents) }, history };
}
