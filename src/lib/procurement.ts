import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export type PurchaseLineInput = { productId: string; quantityOrdered: number; unitCostCents: number };
export type PurchaseDraftInput = {
  supplierId: string; createdById: string; notes?: string | null; lines: PurchaseLineInput[];
};
export type PurchaseStatus = "DRAFT" | "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";

export class ProcurementFailure extends Error {
  constructor(public readonly code:
    "INVALID_LINES" | "INVALID_SUPPLIER" | "INVALID_PRODUCT" |
    "INVALID_STATUS" | "ORDER_NOT_FOUND" | "QUANTITY_CONFLICT" | "ORDER_BUSY") {
    super(code); this.name = "ProcurementFailure";
  }
}
export function validatePurchaseLines(lines: PurchaseLineInput[]) {
  if (!lines.length || lines.length > 40) throw new ProcurementFailure("INVALID_LINES");
  const ids = new Set<string>();
  let total = 0;
  for (const line of lines) {
    if (!line.productId || ids.has(line.productId) ||
      !Number.isSafeInteger(line.quantityOrdered) || line.quantityOrdered < 1 ||
      line.quantityOrdered > 100000 || !Number.isSafeInteger(line.unitCostCents) ||
      line.unitCostCents < 0 || line.unitCostCents > 100000000)
      throw new ProcurementFailure("INVALID_LINES");
    ids.add(line.productId);
    total += line.quantityOrdered * line.unitCostCents;
    if (!Number.isSafeInteger(total) || total > 2_000_000_000)
      throw new ProcurementFailure("INVALID_LINES");
  }
  return total;
}
export function outstandingCount(lines: {quantityOrdered: number;quantityReceived: number}[]) {
  return lines.reduce((sum, line) => sum + line.quantityOrdered - line.quantityReceived, 0);
}
export function nextPurchaseStatus(lines: {quantityOrdered: number;quantityReceived: number}[]): PurchaseStatus {
  if (lines.some(line => line.quantityReceived > line.quantityOrdered || line.quantityReceived < 0))
    throw new ProcurementFailure("QUANTITY_CONFLICT");
  if (lines.every(line => line.quantityReceived === line.quantityOrdered)) return "RECEIVED";
  return lines.some(line => line.quantityReceived > 0) ? "PARTIALLY_RECEIVED" : "ORDERED";
}
function dbBusy(error: unknown) {
  return typeof error === "object" && error !== null &&
    "code" in error && ["P2002","P2034","P1008"].includes(String(error.code));
}
export async function createPurchaseOrder(db: PrismaClient, input: PurchaseDraftInput) {
  validatePurchaseLines(input.lines);
  try {
    return await db.$transaction(async tx => {
      const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
      if (!supplier?.isActive) throw new ProcurementFailure("INVALID_SUPPLIER");
      const products = await tx.product.findMany({
        where: { id: { in: input.lines.map(line => line.productId) }, isActive: true },
        select: {id:true}
      });
      if (products.length !== input.lines.length) throw new ProcurementFailure("INVALID_PRODUCT");
      return tx.purchaseOrder.create({
        data: {
          orderNumber: "PO-" + randomUUID().replaceAll("-", "").slice(0,12).toUpperCase(),
          supplierId: input.supplierId, createdById: input.createdById,
          notes: input.notes ?? null,
          lines: {create: input.lines}
        },
        include: {supplier:true,lines:{include:{product:{select:{name:true,sku:true}}}}}
      });
    });
  } catch(error) {
    if (error instanceof ProcurementFailure) throw error;
    if (dbBusy(error)) throw new ProcurementFailure("ORDER_BUSY");
    throw error;
  }
}
export async function transitionPurchaseOrder(db: PrismaClient, id: string, action: "place" | "cancel") {
  try {
    return await db.$transaction(async tx => {
      const order = await tx.purchaseOrder.findUnique({where:{id}});
      if (!order) throw new ProcurementFailure("ORDER_NOT_FOUND");
      const expected = action === "place" ? "DRAFT" : null;
      if (action === "place" ? order.status !== expected :
        !(order.status === "DRAFT" || order.status === "ORDERED")) {
        throw new ProcurementFailure("INVALID_STATUS");
      }
      const updated = await tx.purchaseOrder.updateMany({
        where:{id,status:order.status},
        data:{status:action === "place" ? "ORDERED" : "CANCELLED"}
      });
      if (updated.count !== 1) throw new ProcurementFailure("ORDER_BUSY");
      return tx.purchaseOrder.findUniqueOrThrow({
        where:{id}, include:{supplier:true,lines:{include:{product:{select:{name:true,sku:true}}}}}
      });
    });
  } catch(error) {
    if (error instanceof ProcurementFailure) throw error;
    if (dbBusy(error)) throw new ProcurementFailure("ORDER_BUSY");
    throw error;
  }
}
export async function procurementOverview(db: PrismaClient) {
  const [suppliers, orders, catalog] = await Promise.all([
    db.supplier.findMany({orderBy:{name:"asc"},take:250}),
    db.purchaseOrder.findMany({take:50,orderBy:{createdAt:"desc"},include:{
      supplier:{select:{id:true,name:true,isActive:true}},
      lines:{include:{product:{select:{name:true,sku:true}}}}
    }}),
    db.product.findMany({where:{isActive:true},orderBy:{name:"asc"},take:2001,
      select:{id:true,name:true,sku:true,stockQty:true,minStockQty:true,costCents:true}})
  ]);
  const lowStock = catalog.filter(item => item.stockQty <= item.minStockQty)
    .map(item => ({...item,recommendedQty:Math.max(1,item.minStockQty*2-item.stockQty)}));
  return {suppliers,orders,lowStock:lowStock.slice(0,100),lowStockTruncated:catalog.length>2000||lowStock.length>100};
}
