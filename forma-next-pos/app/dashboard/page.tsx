import Link from "next/link";
import { ArrowUpRight, Boxes, CircleAlert, ReceiptText, ShoppingCart, Wallet } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [totalProducts, lowStock, saleCount, aggregates, recentSales] = await Promise.all([
    prisma.product.count({ where: { isActive: true } }),
    prisma.product.count({ where: { isActive: true, stockQty: { lte: 5 } } }),
    prisma.sale.count(),
    prisma.sale.aggregate({ _sum: { totalCents: true } }),
    prisma.sale.findMany({ take: 8, orderBy: { createdAt: "desc" }, select: { receiptNumber: true, totalCents: true, paymentMethod: true, createdAt: true } }),
  ]);

  return <AppShell active="dashboard">
    <header className="page-header"><div><div className="eyebrow">OPERATIONS OVERVIEW</div><h1>Dashboard</h1><p>Simple overview of sales and stock in this development database.</p></div><Link className="primary-link" href="/pos"><ShoppingCart size={17} /> Open POS <ArrowUpRight size={16}/></Link></header>
    <div className="dashboard-scroll">
      <div className="stats-grid">
        <div className="stat-card"><span className="stat-icon green"><Wallet size={20}/></span><span className="stat-label">Recorded revenue</span><strong>{formatMoney(aggregates._sum.totalCents ?? 0)}</strong><small>All recorded sales</small></div>
        <div className="stat-card"><span className="stat-icon blue"><ReceiptText size={20}/></span><span className="stat-label">Transactions</span><strong>{saleCount}</strong><small>Successful checkouts</small></div>
        <div className="stat-card"><span className="stat-icon violet"><Boxes size={20}/></span><span className="stat-label">Active products</span><strong>{totalProducts}</strong><small>In product catalog</small></div>
        <div className="stat-card"><span className="stat-icon orange"><CircleAlert size={20}/></span><span className="stat-label">Low stock</span><strong>{lowStock}</strong><small>Stock level 5 or below</small></div>
      </div>
      <section className="panel"><div className="panel-heading"><div><h2>Recent sales</h2><p>Latest completed transactions</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>Receipt</th><th>Date</th><th>Payment</th><th className="right">Total</th></tr></thead><tbody>
        {recentSales.length ? recentSales.map((sale) => <tr key={sale.receiptNumber}><td className="mono">{sale.receiptNumber}</td><td>{sale.createdAt.toLocaleString("en-LK")}</td><td><span className="chip">{sale.paymentMethod}</span></td><td className="right strong">{formatMoney(sale.totalCents)}</td></tr>) : <tr><td colSpan={4} className="empty-cell">No sales yet. Complete a checkout to see sales here.</td></tr>}
      </tbody></table></div></section>
    </div>
  </AppShell>;
}
