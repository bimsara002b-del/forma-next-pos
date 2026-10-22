import Link from "next/link";
import { Boxes, LayoutDashboard, ShoppingCart, Store, ShieldAlert } from "lucide-react";

type Props = { children: React.ReactNode; active: "pos" | "dashboard" | "products" };

const nav = [
  { path: "/pos", label: "Point of sale", key: "pos" as const, icon: ShoppingCart },
  { path: "/dashboard", label: "Dashboard", key: "dashboard" as const, icon: LayoutDashboard },
  { path: "/products", label: "Products", key: "products" as const, icon: Boxes },
];

export function AppShell({ children, active }: Props) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/pos" className="brand" aria-label="Forma POS home">
          <span className="brand-mark"><Store size={22} strokeWidth={2.4} /></span>
          <span><strong>forma<span className="brand-dot">.</span></strong><small>POINT OF SALE</small></span>
        </Link>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {nav.map((item) => (
            <Link key={item.path} href={item.path} className={`nav-item ${active === item.key ? "active" : ""}`} aria-current={active === item.key ? "page" : undefined}>
              <item.icon size={19} /> {item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="status-pill"><span className="status-dot" /> Development mode</div>
          <p><ShieldAlert size={14} /> Demo only — no user login or payment gateway yet.</p>
        </div>
      </aside>
      <div className="main-area">{children}</div>
    </div>
  );
}
