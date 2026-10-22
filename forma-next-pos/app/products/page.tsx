import Link from "next/link";
import { ArrowUpRight, Boxes } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const products = await prisma.product.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] });
  return <AppShell active="products">
    <header className="page-header"><div><div className="eyebrow">CATALOG & INVENTORY</div><h1>Products</h1><p>Read-only product list. Inventory adjustments are planned for a later milestone.</p></div><Link href="/pos" className="primary-link">Go to checkout <ArrowUpRight size={17}/></Link></header>
    <div className="dashboard-scroll"><section className="panel"><div className="panel-heading"><div><h2><Boxes size={19}/> Inventory overview</h2><p>{products.length} items</p></div></div><div className="table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th>Category</th><th className="right">Price</th><th className="right">Stock</th></tr></thead><tbody>
      {products.length ? products.map((product) => <tr key={product.id}><td className="strong">{product.name}</td><td className="mono">{product.sku}</td><td>{product.category}</td><td className="right">{formatMoney(product.priceCents)}</td><td className="right"><span className={`stock-indicator ${product.stockQty <= product.minStockQty ? "stock-low" : ""}`}>{product.stockQty} units</span></td></tr>) : <tr><td colSpan={5} className="empty-cell">No products. Run the seed command from README.</td></tr>}
    </tbody></table></div></section></div>
  </AppShell>;
}
