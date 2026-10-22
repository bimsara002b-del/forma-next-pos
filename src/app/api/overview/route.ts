import { authError, isAuthenticated } from "@/lib/auth";
import { prisma } from "@/lib/db";
export const runtime = "nodejs";
export async function GET() {
  if (!await isAuthenticated()) return authError();
  const [productsCount, lowStock, salesCount, totals, sales] = await Promise.all([
    prisma.product.count({ where: { isActive: true } }),
    prisma.product.count({ where: { isActive: true, stockQty: { lte: 5 } } }),
    prisma.sale.count(),
    prisma.sale.aggregate({ _sum: { totalCents: true } }),
    prisma.sale.findMany({ take: 60, orderBy: { createdAt: "desc" },
      select: { id: true, receiptNumber: true, totalCents: true, receivedCents: true,
        changeCents: true, createdAt: true, _count: { select: { items: true } } } })
  ]);
  return Response.json({ stats: { productsCount, lowStock, salesCount, revenueCents: totals._sum.totalCents ?? 0 },
    sales: sales.map(sale => ({ id: sale.id, receiptNumber: sale.receiptNumber, totalCents: sale.totalCents,
      receivedCents: sale.receivedCents, changeCents: sale.changeCents,
      createdAt: sale.createdAt.toISOString(), lines: sale._count.items })) },
    { headers: { "Cache-Control": "no-store" } });
}
