import { PrismaClient } from "@prisma/client";

export type ReportingWindow = { from: Date; toExclusive: Date; fromDate: string; toDate: string };
export class ReportInputError extends Error {}
const DAY_MS = 86_400_000;

export function parseReportWindow(fromParam: string | null, toParam: string | null, today = new Date()): ReportingWindow {
  const todayDate = today.toISOString().slice(0, 10);
  const fromDefault = new Date(Date.parse(todayDate + "T00:00:00Z") - 29 * DAY_MS).toISOString().slice(0, 10);
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
  return { from: new Date(fromMs), toExclusive: new Date(toMs + DAY_MS), fromDate, toDate };
}
type HistorySale = { createdAt: Date; totalCents: number };
export function salesByUtcDay(sales: HistorySale[], window: ReportingWindow) {
  const result = new Map<string, { date: string; salesCount: number; revenueCents: number }>();
  for (let time = window.from.getTime(); time < window.toExclusive.getTime(); time += DAY_MS) {
    const date = new Date(time).toISOString().slice(0, 10);
    result.set(date, { date, salesCount: 0, revenueCents: 0 });
  }
  for (const sale of sales) {
    const date = sale.createdAt.toISOString().slice(0, 10);
    const bucket = result.get(date);
    if (bucket) { bucket.salesCount += 1; bucket.revenueCents += sale.totalCents; }
  }
  return [...result.values()];
}

export async function generateReports(db: PrismaClient, window: ReportingWindow) {
  const where = { createdAt: { gte: window.from, lt: window.toExclusive } };
  const lineWhere = { sale: { createdAt: { gte: window.from, lt: window.toExclusive } } };
  const knownCostLineWhere = { ...lineWhere, lineCostCents: { not: null } };
  const [
    saleTotals, itemTotals, knownCostTotals, knownCostLineCount,
    topProducts, dailySalesLimited, products, closingShifts, refunded
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
    })
  ]);

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
    period: { from: window.fromDate, to: window.toDate, timezone: "UTC" },
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
    refunds: {
      count: refunded._count._all,
      amountCents: refunded._sum.refundCents ?? 0,
      netCashRevenueCents: (saleTotals._sum.totalCents ?? 0) - (refunded._sum.refundCents ?? 0),
      note: "Refunds grouped by refund date; gross sales grouped by sale date. Coverage-specific gross profit does not subtract refund cost/revenue."
    },
    closedShifts: {
      count: closingShifts._count._all,
      netCashVarianceCents: closingShifts._sum.varianceCents ?? 0
    },
    topProducts: topProducts.map(item => ({
      productId: item.productId, name: item.productName,
      quantity: item._sum.quantity ?? 0, revenueCents: item._sum.lineTotalCents ?? 0
    })),
    daily: dailyComplete ? salesByUtcDay(dailySalesLimited, window) : null,
    dailyChartComplete: dailyComplete
  };
}
