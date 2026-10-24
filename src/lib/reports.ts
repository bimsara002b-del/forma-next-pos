import { PrismaClient } from "@prisma/client";
import {summarizeRefundMargin} from "./refund-margin";
import { sriLankaDate, dateDaysBefore, COLOMBO_OFFSET_MS, REPORT_TIMEZONE } from "./report-calendar";

export type ReportingWindow = { from: Date; toExclusive: Date; fromDate: string; toDate: string };
export class ReportInputError extends Error {}
const DAY_MS = 86_400_000;

export function parseReportWindow(fromParam: string | null, toParam: string | null, today = new Date()): ReportingWindow {
  const todayDate = sriLankaDate(today);
  const fromDefault = dateDaysBefore(todayDate, 29);
  const fromDate = fromParam ?? fromDefault, toDate = toParam ?? todayDate;
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(fromDate) || !dateRe.test(toDate)) throw new ReportInputError("Invalid date. Use YYYY-MM-DD.");
  const toUtcMs = (input: string) => {
    const value = Date.parse(input + "T00:00:00Z");
    if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== input) {
      throw new ReportInputError("Invalid calendar date.");
    }
    return value;
  };
  const fromMs = toUtcMs(fromDate), toMs = toUtcMs(toDate);
  if (toMs < fromMs || (toMs - fromMs) / DAY_MS >= 90) {
    throw new ReportInputError("Select 1–90 calendar days in chronological order.");
  }
  return { from: new Date(fromMs - COLOMBO_OFFSET_MS), toExclusive: new Date(toMs + DAY_MS - COLOMBO_OFFSET_MS), fromDate, toDate };
}
type HistorySale = { createdAt: Date; totalCents: number };
export function salesBySriLankaDay(sales: HistorySale[], window: ReportingWindow) {
  const result = new Map<string, { date: string; salesCount: number; revenueCents: number }>();
  for (let time = window.from.getTime() + COLOMBO_OFFSET_MS; time < window.toExclusive.getTime() + COLOMBO_OFFSET_MS; time += DAY_MS) {
    const date = new Date(time).toISOString().slice(0, 10);
    result.set(date, { date, salesCount: 0, revenueCents: 0 });
  }
  for (const sale of sales) {
    const date = sriLankaDate(sale.createdAt);
    const bucket = result.get(date);
    if (bucket) { bucket.salesCount += 1; bucket.revenueCents += sale.totalCents; }
  }
  return [...result.values()];
}

/** Refunds already have a negative REFUND cash movement. Never subtract them twice. */
export function reconcileShiftLedger(input:{
 openingFloatCents:number;cashSalesCents:number;cashMovementsCents:number;
 recordedExpectedCents:number|null;countedCashCents:number|null;recordedVarianceCents:number|null;
}){
 const ledgerExpectedCents=input.openingFloatCents+input.cashSalesCents+input.cashMovementsCents;
 if(![input.openingFloatCents,input.cashSalesCents,input.cashMovementsCents,ledgerExpectedCents].every(Number.isSafeInteger))
  throw new ReportInputError("Invalid cash shift ledger.");
 const ledgerVarianceCents=input.countedCashCents===null?null:input.countedCashCents-ledgerExpectedCents;
 const matchesClosingSnapshot=input.recordedExpectedCents===ledgerExpectedCents &&
  input.recordedVarianceCents===ledgerVarianceCents;
 return {ledgerExpectedCents,ledgerVarianceCents,matchesClosingSnapshot};
}

export async function generateReports(db: PrismaClient, window: ReportingWindow) {
  const where = { createdAt: { gte: window.from, lt: window.toExclusive } };
  const lineWhere = { sale: { createdAt: { gte: window.from, lt: window.toExclusive } } };
  const knownCostLineWhere = { ...lineWhere, lineCostCents: { not: null } };
  const [
    saleTotals, itemTotals, knownCostTotals, knownCostLineCount,
    topProducts, dailySalesLimited, products, closingShifts, refunded, recentShiftRows, refundHistory
  ] = await Promise.all([
    db.sale.aggregate({ where, _count: { _all: true }, _sum: { totalCents: true } }),
    db.saleItem.aggregate({ where: lineWhere, _count: { _all: true }, _sum: { quantity: true } }),
    db.saleItem.aggregate({ where: knownCostLineWhere, _sum: { lineTotalCents: true, lineCostCents: true } }),
    db.saleItem.count({ where: knownCostLineWhere }),
    db.saleItem.groupBy({
      by: ["productId", "productName"],
      where: lineWhere,
      _sum: { quantity: true, lineTotalCents: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 10
    }),
    db.sale.findMany({ where, orderBy: { createdAt: "asc" },
      select: { createdAt: true, totalCents: true }, take: 10_001 }),
    db.product.findMany({
      where: { isActive: true },
      select: { stockQty: true, costCents: true, minStockQty: true }
    }),
    db.cashShift.aggregate({
      where: { status: "CLOSED", closedAt: { gte: window.from, lt: window.toExclusive } },
      _count: { _all: true }, _sum: { varianceCents: true }
    }),
    db.saleReturn.aggregate({
      where: { createdAt: { gte: window.from, lt: window.toExclusive } },
      _count: { _all: true }, _sum: { refundCents: true }
    }),
    db.saleReturnLine.findMany({
      where:{saleReturn:{createdAt:{gte:window.from,lt:window.toExclusive}}},
      select:{quantity:true,refundCents:true,restocked:true,
        saleItem:{select:{unitCostCents:true}}}
    }),
    db.cashShift.findMany({where:{status:"CLOSED",closedAt:{gte:window.from,lt:window.toExclusive}},
      orderBy:{closedAt:"desc"},take:20,
      select:{id:true,openedAt:true,closedAt:true,openingFloatCents:true,countedCashCents:true,expectedCashCents:true,varianceCents:true}})
  ]);

  const refundMargin=summarizeRefundMargin(refundHistory.map(line=>({quantity:line.quantity,
    refundCents:line.refundCents,restocked:line.restocked,
    unitCostCents:line.saleItem.unitCostCents})));
  const recentShiftIds=recentShiftRows.map(shift=>shift.id);
  const [shiftSales,shiftMovements]=await Promise.all([
    db.sale.groupBy({by:["shiftId"],where:{shiftId:{in:recentShiftIds},paymentMethod:"CASH"},
      _sum:{totalCents:true}}),
    db.cashMovement.groupBy({by:["shiftId","type"],where:{shiftId:{in:recentShiftIds}},
      _sum:{changeCents:true}})
  ]);
  const salesByShift=new Map(shiftSales.map(row=>[row.shiftId,row._sum.totalCents??0]));
  const movementByShift=new Map<string,{cashInCents:number;cashOutCents:number;refundCents:number;otherCents:number}>();
  for(const movement of shiftMovements){
    const id=movement.shiftId,existing=movementByShift.get(id)??{
      cashInCents:0,cashOutCents:0,refundCents:0,otherCents:0
    };
    const amount=movement._sum.changeCents??0;
    if(movement.type==="CASH_IN")existing.cashInCents+=amount;
    else if(movement.type==="CASH_OUT")existing.cashOutCents+=amount;
    else if(movement.type==="REFUND")existing.refundCents+=amount;
    else existing.otherCents+=amount;
    movementByShift.set(id,existing);
  }
  const shiftReconciliation=recentShiftRows.map(shift=>{
    const salesCents=salesByShift.get(shift.id)??0;
    const movements=movementByShift.get(shift.id)??{cashInCents:0,cashOutCents:0,refundCents:0,otherCents:0};
    const netMovementsCents=movements.cashInCents+movements.cashOutCents+
      movements.refundCents+movements.otherCents;
    const computed=reconcileShiftLedger({
      openingFloatCents:shift.openingFloatCents,cashSalesCents:salesCents,
      cashMovementsCents:netMovementsCents,recordedExpectedCents:shift.expectedCashCents,
      countedCashCents:shift.countedCashCents,recordedVarianceCents:shift.varianceCents
    });
    return {id:shift.id,openedAt:shift.openedAt.toISOString(),
      closedAt:shift.closedAt?.toISOString()??null,openingFloatCents:shift.openingFloatCents,
      cashSalesCents:salesCents,...movements,netMovementsCents,
      recordedExpectedCents:shift.expectedCashCents,countedCashCents:shift.countedCashCents,
      recordedVarianceCents:shift.varianceCents,...computed};
  });

  // Never display a partially aggregated daily chart as if it were complete.
  const dailyComplete = dailySalesLimited.length <= 10_000;
  const knownRevenueCents = knownCostTotals._sum.lineTotalCents ?? 0;
  const knownCostCents = knownCostTotals._sum.lineCostCents ?? 0;
  const inventory = products.reduce((acc, product) => {
    if (product.stockQty <= product.minStockQty) acc.lowStockProducts += 1;
    if (product.costCents > 0) {
      acc.knownCostStockUnits += product.stockQty;
      acc.knownCostValuationCents += product.stockQty * product.costCents;
    } else {
      acc.unknownCostProducts += 1;
    }
    return acc;
  }, { lowStockProducts: 0, knownCostStockUnits: 0, knownCostValuationCents: 0, unknownCostProducts: 0 });

  return {
    period: { from: window.fromDate, to: window.toDate, timezone: REPORT_TIMEZONE },
    sales: {
      count: saleTotals._count._all,
      revenueCents: saleTotals._sum.totalCents ?? 0,
      unitsSold: itemTotals._sum.quantity ?? 0
    },
    margin: {
      knownCostLineCount,
      unknownCostLineCount: itemTotals._count._all - knownCostLineCount,
      coveredRevenueCents: knownRevenueCents,
      knownCostCents,
      grossProfitOnCoveredSalesCents: knownRevenueCents - knownCostCents,
      // This is NOT company net profit or historical full-period profit.
      method: "Recorded cost snapshots only; missing-cost historical sales excluded."
    },
    inventory: { ...inventory, activeProductCount: products.length,
      valuationMethod: "Current stock × current known unit cost, not historical FIFO." },
    refundMargin:{...refundMargin,
      knownCostSalesMarginCents:knownRevenueCents-knownCostCents,
      adjustedKnownCostMarginCents:knownRevenueCents-knownCostCents+refundMargin.knownRefundMarginImpactCents,
      note:"Sales grouped by sale date; returns by refund date. Adjusted known-cost margin excludes sales and returns with missing historical costs; not full net profit."},
    refunds: {
      count: refunded._count._all,
      amountCents: refunded._sum.refundCents ?? 0,
      netCashRevenueCents: (saleTotals._sum.totalCents ?? 0) - (refunded._sum.refundCents ?? 0),
      note: "Refunds grouped by refund date; gross sales grouped by sale date. Coverage-specific gross profit does not subtract refund cost/revenue."
    },
    shiftReconciliation: {recent:shiftReconciliation,limited:closingShifts._count._all>20},
    closedShifts: {
      count: closingShifts._count._all,
      netCashVarianceCents: closingShifts._sum.varianceCents ?? 0
    },
    topProducts: topProducts.map(item => ({
      productId: item.productId, name: item.productName,
      quantity: item._sum.quantity ?? 0, revenueCents: item._sum.lineTotalCents ?? 0
    })),
    daily: dailyComplete ? salesBySriLankaDay(dailySalesLimited, window) : null,
    dailyChartComplete: dailyComplete
  };
}
