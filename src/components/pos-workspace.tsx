"use client";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AdvancedInventory } from "./advanced-inventory";
import {
  Activity, ArrowRight, Barcode, Boxes, CheckCircle2, CircleAlert, CreditCard,
  LayoutDashboard, LogOut, Minus, Package, Plus, Printer, ReceiptText, RefreshCcw,
  Search, ShoppingBasket, ShoppingCart, Trash2, TrendingUp, Users, Wallet, X
} from "lucide-react";
import { formatMoney, parseMoney } from "@/lib/money";

type View = "pos" | "dashboard" | "inventory" | "sales" | "shifts";
type Product = {
  id: string; sku: string; barcode: string | null; name: string; category: string;
  priceCents: number; costCents: number; stockQty: number; minStockQty: number;
};
type SaleSummary = { id: string; receiptNumber: string; totalCents: number; receivedCents: number;
  changeCents: number; createdAt: string; lines: number };
type Stats = { productsCount: number; lowStock: number; salesCount: number; revenueCents: number };
type Receipt = { id: string; receiptNumber: string; totalCents: number; receivedCents: number; changeCents: number;
  createdAt: string; items: { productName: string; quantity: number; unitPriceCents: number; lineTotalCents: number }[] };
type Cart = { productId: string; quantity: number };
type NewProduct = { sku: string; barcode: string; name: string; category: string; price: string; cost: string; stock: string };
const emptyNew: NewProduct = { sku: "", barcode: "", name: "", category: "General", price: "", cost: "0", stock: "0" };

async function readJson<T>(response: Response): Promise<T> {
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) throw new Error("Your session expired. Sign in again.");
    throw new Error(result.error ?? "Request failed");
  }
  return result as T;
}

export function PosWorkspace({canManageStaff=false,canManageInventory=true}:{canManageStaff?:boolean;canManageInventory?:boolean}) {
  const router = useRouter();
  const [view, setView] = useState<View>("pos");
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [stats, setStats] = useState<Stats>({ productsCount: 0, lowStock: 0, salesCount: 0, revenueCents: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [cart, setCart] = useState<Cart[]>([]);
  const [modal, setModal] = useState<"checkout" | "product" | null>(null);
  const [received, setReceived] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkoutUncertain, setCheckoutUncertain] = useState(false);
  const [busyStock, setBusyStock] = useState("");
  const [notice, setNotice] = useState("");
  const [lastReceipt, setLastReceipt] = useState<Receipt | null>(null);
  const [newProduct, setNewProduct] = useState<NewProduct>(emptyNew);
  const searchInput = useRef<HTMLInputElement>(null);
  const checkoutRequestId = useRef("");

  const loadData = useCallback(async () => {
    const [catalog, overview] = await Promise.all([
      fetch("/api/products", { cache: "no-store" }).then(r => readJson<{ products: Product[] }>(r)),
      fetch("/api/overview", { cache: "no-store" }).then(r => readJson<{ stats: Stats; sales: SaleSummary[] }>(r))
    ]);
    return { catalog, overview };
  }, []);
  const refresh = useCallback(async () => {
    try {
      const { catalog, overview } = await loadData();
      setProducts(catalog.products);
      setSales(overview.sales);
      setStats(overview.stats);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not load store data.");
    } finally {
      setLoading(false);
    }
  }, [loadData]);
  useEffect(() => {
    // Subscribe to the results of the initial asynchronous load; never synchronously
    // update React state while the effect is being established.
    let cancelled = false;
    void loadData()
      .then(({ catalog, overview }) => {
        if (cancelled) return;
        setProducts(catalog.products);
        setSales(overview.sales);
        setStats(overview.stats);
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice(error instanceof Error ? error.message : "Could not load store data.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [loadData]);

  const categories = useMemo(() => ["All", ...new Set(products.map(item => item.category))], [products]);
  const filtered = useMemo(() => products.filter(item =>
    (category === "All" || item.category === category) &&
    [item.name, item.sku, item.barcode ?? ""].some(value => value.toLowerCase().includes(search.trim().toLowerCase()))
  ), [products, category, search]);
  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const lines = useMemo(() => cart.flatMap(item => {
    const product = byId.get(item.productId);
    return product ? [{ product, quantity: item.quantity }] : [];
  }), [cart, byId]);
  const totalCents = lines.reduce((sum, line) => sum + line.product.priceCents * line.quantity, 0);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  const addProductToCart = useCallback((product: Product) => {
    setCart(previous => {
      const current = previous.find(item => item.productId === product.id);
      if ((current?.quantity ?? 0) >= product.stockQty) return previous;
      return current
        ? previous.map(item => item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item)
        : [...previous, { productId: product.id, quantity: 1 }];
    });
  }, []);
  const adjustCart = (id: string, delta: number) => setCart(previous => previous.flatMap(item => {
    if (item.productId !== id) return [item];
    const count = item.quantity + delta;
    if (count <= 0) return [];
    return [{ ...item, quantity: Math.min(count, byId.get(id)?.stockQty ?? 0) }];
  }));
  const scan = () => {
    const query = search.trim();
    const exact = products.find(p => p.barcode === query || p.sku.toLowerCase() === query.toLowerCase());
    const candidate = exact ?? (filtered.length === 1 ? filtered[0] : null);
    if (!candidate || candidate.stockQty <= 0) { setNotice("Product not found or out of stock."); return; }
    addProductToCart(candidate);
    setSearch(""); setNotice("");
  };
  const openCheckout = useCallback(() => {
    if (!cart.length) return;
    if (!checkoutRequestId.current) checkoutRequestId.current = crypto.randomUUID();
    setReceived((totalCents / 100).toFixed(2)); setModal("checkout"); setNotice("");
  }, [cart.length, totalCents]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "F2") { event.preventDefault(); setView("pos"); setTimeout(() => searchInput.current?.focus(), 0); }
      if (event.key === "F4" && !modal && view === "pos") { event.preventDefault(); openCheckout(); }
      if (event.key === "Escape" && modal && !busy && !checkoutUncertain) setModal(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [modal, busy, view, openCheckout, checkoutUncertain]);

  const receivedCents = parseMoney(received);
  const canPay = receivedCents !== null && receivedCents >= totalCents && !busy && cart.length > 0;
  const changeCents = receivedCents === null ? 0 : Math.max(0, receivedCents - totalCents);
  async function completeSale() {
    if (!canPay || !checkoutRequestId.current) return;
    setBusy(true); setNotice("");
    try {
      const data = await fetch("/api/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: checkoutRequestId.current, items: cart, receivedCents })
      }).then(r => readJson<{ sale: Receipt }>(r));
      checkoutRequestId.current = "";
      setCheckoutUncertain(false);
      setLastReceipt(data.sale); setModal(null); setCart([]);
      setNotice("Cash sale " + data.sale.receiptNumber + " saved successfully.");
      await refresh();
    } catch (e) {
      // A request may have reached the database even if the response was lost.
      // Keep the original cart, tender and idempotency key for a safe retry.
      setCheckoutUncertain(true);
      setNotice((e instanceof Error ? e.message : "Cannot confirm sale.") +
        " Verify the sale or retry this SAME checkout without changing the amount.");
    } finally { setBusy(false); }
  }
  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const priceCents = parseMoney(newProduct.price);
    const costCents = parseMoney(newProduct.cost);
    const stockQty = Number(newProduct.stock);
    if (priceCents === null || costCents === null || !Number.isInteger(stockQty) || stockQty < 0) {
      setNotice("Enter a valid price, cost and opening stock."); return;
    }
    setBusy(true); setNotice("");
    try {
      await fetch("/api/products", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProduct.name, sku: newProduct.sku, barcode: newProduct.barcode,
          category: newProduct.category, priceCents, costCents, stockQty })
      }).then(r => readJson(r));
      setNewProduct(emptyNew); setModal(null);
      await refresh(); setNotice("New product added.");
    } catch (e) { setNotice(e instanceof Error ? e.message : "Product was not created."); }
    finally { setBusy(false); }
  }
  async function adjustStock(product: Product, delta: number) {
    setBusyStock(product.id); setNotice("");
    try {
      await fetch("/api/stock", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id, delta, reason: delta > 0 ? "RECEIVING" : "ADJUSTMENT" })
      }).then(r => readJson(r));
      await refresh();
      setNotice(product.name + (delta > 0 ? ": 10 units received." : ": 1 unit adjusted out."));
    } catch (e) { setNotice(e instanceof Error ? e.message : "Stock update failed."); }
    finally { setBusyStock(""); }
  }
  async function logout() {
    try { await fetch("/api/auth/logout", { method: "POST" }); } finally { router.replace("/login"); router.refresh(); }
  }
  const navigation: { key: View; title: string; icon: typeof ShoppingCart }[] = [
    { key: "pos", title: "Point of Sale", icon: ShoppingCart },
    { key: "dashboard", title: "Dashboard", icon: LayoutDashboard },
    ...(canManageInventory ? [{ key: "inventory" as View, title: "Inventory", icon: Boxes }] : []),
    { key: "sales", title: "Sales History", icon: ReceiptText },
    { key: "shifts", title: "Cash Shifts", icon: Wallet }
  ];
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-icon"><ShoppingBasket size={22}/></span><span>FORMA<b>POS</b><small>NEXT GENERATION</small></span></div>
      <div className="side-caption">WORKSPACE</div>
      <nav aria-label="Main navigation">
        {navigation.map(entry => <button type="button" key={entry.key} className={"nav-button" + (entry.key === view ? " active" : "")} onClick={() => setView(entry.key)}>
          <entry.icon size={19} strokeWidth={1.8}/><span>{entry.title}</span>{entry.key === "pos" && <small>F4</small>}
        </button>)}
        {canManageStaff && <Link className="nav-button" href="/staff"><Users size={19}/><span>Staff Accounts</span></Link>}
      </nav>
      <div className="sidebar-foot"><div className="store-avatar">F</div><div className="sidebar-store"><strong>Forma Demo Store</strong><small>Local register 01</small></div>
        <button title="Sign out" aria-label="Sign out" onClick={() => void logout()}><LogOut size={18}/></button></div>
    </aside>
    <main className="main-panel">
      <div className="page-topbar">
        <div><div className="eyebrow">SALES WORKSPACE <span>/</span> {view.toUpperCase()}</div>
          <h1>{view === "pos" ? "Point of sale" : view === "dashboard" ? "Overview" : view === "inventory" ? "Inventory" : view === "shifts" ? "Cash shifts" : "Sales history"}</h1>
        </div>
        <div className="topbar-meta"><span className="demo-badge"><i/> DEVELOPMENT DEMO</span>
          <button type="button" onClick={() => void refresh()} aria-label="Refresh data" title="Refresh data"><RefreshCcw size={17}/></button></div>
      </div>
      {notice && <div role="status" className="notification"><CircleAlert size={17}/><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={16}/></button></div>}
      {view === "pos" && <div className="pos-layout">
        <section className="catalog">
          <div className="section-heading"><div><h2>Product catalog</h2><p>Find a product, or scan a barcode</p></div><span className="shortcut">F2 Search</span></div>
          <div className="search-box"><Search size={19}/><input aria-label="Search by product, SKU or barcode" ref={searchInput} value={search}
            onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); scan(); } }}
            placeholder="Search name, SKU or scan barcode…" autoComplete="off" /><Barcode size={19}/></div>
          <div className="categories">{categories.map(name => <button key={name} className={category === name ? "selected" : ""} onClick={() => setCategory(name)}>{name}</button>)}</div>
          <div className="list-header"><strong>{category === "All" ? "All products" : category}</strong><span>{filtered.length} results</span></div>
          <div className="product-scroll">
            <div className="product-grid">{filtered.map(product => {
              const inCart = cart.find(c => c.productId === product.id)?.quantity ?? 0;
              const disabled = product.stockQty <= inCart;
              return <button type="button" key={product.id} className="product-card" disabled={disabled} onClick={() => addProductToCart(product)}>
                <span className="product-art"><Package size={28}/></span><span className="product-category">{product.category}</span>
                <strong>{product.name}</strong><small>{product.sku}</small>
                <div className="product-card-bottom"><span>{formatMoney(product.priceCents)}</span><span className="mini-plus"><Plus size={17}/></span></div>
                <span className={"product-stock" + (product.stockQty <= 5 ? " low" : "")}>{product.stockQty === 0 ? "Out of stock" : product.stockQty + " in stock"}</span>
              </button>;
            })}</div>
            {!loading && filtered.length === 0 && <div className="empty-state"><Package size={38}/><strong>No matching products</strong><p>Try another barcode or product name.</p></div>}
          </div>
        </section>
        <section className="cart-panel" aria-label="Current order">
          <div className="cart-header"><div className="cart-header-icon"><ShoppingBagIcon/></div><div><h2>Current order</h2><small>{itemCount} items in cart</small></div><span className="order-label">NEW SALE</span></div>
          <div className="cart-title"><span>ORDER ITEMS</span><button type="button" onClick={() => setCart([])} disabled={!cart.length}><Trash2 size={13}/> Clear all</button></div>
          <div className="cart-scroll">{lines.length ? lines.map(({ product, quantity }) => <div key={product.id} className="cart-line">
            <div className="cart-icon"><Package size={21}/></div><div className="cart-line-body">
              <div className="cart-line-top"><strong>{product.name}</strong><b>{formatMoney(product.priceCents * quantity)}</b></div>
              <small>{formatMoney(product.priceCents)} each</small>
              <div className="qty-control"><button aria-label={"Decrease " + product.name} onClick={() => adjustCart(product.id, -1)}><Minus size={13}/></button>
                <span>{quantity}</span><button aria-label={"Increase " + product.name} disabled={quantity >= product.stockQty} onClick={() => adjustCart(product.id, 1)}><Plus size={13}/></button></div>
            </div></div>) : <div className="empty-cart"><ShoppingCart size={38}/><strong>Cart is empty</strong><p>Select a product or scan a barcode to start a new sale.</p></div>}</div>
          <div className="cart-summary"><div className="sum-row"><span>Subtotal</span><strong>{formatMoney(totalCents)}</strong></div>
            <div className="sum-row subdued"><span>Tax / discounts</span><span>Not configured</span></div>
            <div className="sum-total"><span>Total due</span><strong>{formatMoney(totalCents)}</strong></div>
            <button className="primary-action" disabled={cart.length === 0} onClick={openCheckout}><span>Checkout</span><strong>{formatMoney(totalCents)}</strong><ArrowRight size={18}/></button>
            <div className="shortcut-note">Press <kbd>F4</kbd> for checkout</div>
          </div>
        </section>
      </div>}
      {view === "dashboard" && <div className="content-scroll">
        <div className="content-heading"><div><h2>Business overview</h2><p>Recorded demo totals since database creation</p></div><span className="subtle-pill"><Activity size={14}/> Live database</span></div>
        <div className="stat-grid">
          <Stat title="Total sales" value={formatMoney(stats.revenueCents)} icon={TrendingUp} tone="green"/>
          <Stat title="Transactions" value={String(stats.salesCount)} icon={ReceiptText} tone="blue"/>
          <Stat title="Products" value={String(stats.productsCount)} icon={Package} tone="violet"/>
          <Stat title="Low stock" value={String(stats.lowStock)} icon={CircleAlert} tone="amber"/>
        </div>
        <div className="panel"><div className="panel-header"><h3>Recent transactions</h3><button className="text-link" onClick={() => setView("sales")}>View all <ArrowRight size={15}/></button></div>
          <SalesTable sales={sales.slice(0, 8)}/></div>
      </div>}
      {view === "inventory" && <div className="content-scroll">
        <div className="content-heading"><div><h2>Product inventory</h2><p>Manage products and record stock movements</p></div>
          <button className="small-action" onClick={() => setModal("product")}><Plus size={17}/> Add product</button></div>
        <div className="panel"><div className="panel-header"><h3>Catalog and stock</h3><span className="subtle-pill">{products.length} active products</span></div>
          <div className="table-scroll"><table><thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Unit price</th><th>Stock</th><th>Stock actions</th></tr></thead>
            <tbody>{products.map(product => <tr key={product.id}>
              <td className="table-strong">{product.name}</td><td className="mono">{product.sku}</td><td>{product.category}</td><td>{formatMoney(product.priceCents)}</td>
              <td><span className={"stock-pill" + (product.stockQty <= 5 ? " low" : "")}>{product.stockQty} units</span></td>
              <td><div className="stock-actions"><button disabled={busyStock === product.id} onClick={() => void adjustStock(product, 10)} aria-label={"Receive 10 " + product.name}><Plus size={13}/> 10</button>
                <button disabled={busyStock === product.id || product.stockQty === 0} onClick={() => void adjustStock(product, -1)} aria-label={"Adjust out 1 " + product.name}><Minus size={13}/> 1</button></div></td>
            </tr>)}</tbody></table></div>
          {!products.length && <div className="table-empty">No products yet. Add a product to begin.</div>}
        </div>
        <AdvancedInventory onUpdated={refresh}/>
      </div>}
      {view === "shifts" && <div className="content-scroll"><CashShiftPanel /></div>}
      {view === "sales" && <div className="content-scroll">
        <div className="content-heading"><div><h2>Sales history</h2><p>Recent completed cash sales (newest first)</p></div><span className="subtle-pill">{sales.length} latest records</span></div>
        <div className="panel"><div className="panel-header"><h3>Recent receipts</h3><span className="subtle-pill">Cash only</span></div><SalesTable sales={sales}/></div>
      </div>}
    </main>
    {modal === "checkout" && <div className="modal-overlay" role="presentation"><div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="pay-title">
      <div className="modal-top"><div><span className="label-top">PAYMENT</span><h2 id="pay-title">Complete cash sale</h2></div><button className="icon-control" aria-label="Close" disabled={busy || checkoutUncertain} onClick={() => { checkoutRequestId.current = ""; setModal(null); }}><X size={20}/></button></div>
      <div className="modal-content"><div className="due-box"><span>TOTAL AMOUNT DUE</span><strong>{formatMoney(totalCents)}</strong><small>{itemCount} items</small></div>
        <div className="cash-choice"><span><CreditCard size={19}/> Cash payment</span><CheckCircle2 size={19}/></div>
        <label className="field-label" htmlFor="tender">Cash received (LKR)</label>
        <input id="tender" className="money-input" inputMode="decimal" autoFocus disabled={checkoutUncertain} value={received} onChange={e => setReceived(e.target.value)}/>
        <div className="change-line"><span>Change to return</span><strong>{formatMoney(changeCents)}</strong></div>
        {receivedCents === null ? <p className="form-error">Enter a valid amount (e.g. 1500.00).</p> :
          receivedCents < totalCents ? <p className="form-error">Cash received must cover the total.</p> : null}
        <div className="notice-small">{checkoutUncertain
          ? "Could not confirm sale status. Do NOT create a new order. Retry unchanged or check Sales History."
          : "Prices are rechecked against the database when you confirm. No card payment is processed."}</div>
      </div>
      <div className="modal-actions"><button className="secondary-action" onClick={() => { checkoutRequestId.current = ""; setModal(null); }} disabled={busy || checkoutUncertain}>Cancel</button>
        <button className="primary-action" disabled={!canPay} onClick={() => void completeSale()}>{busy ? "Processing…" : "Save cash sale"}<ArrowRight size={17}/></button></div>
    </div></div>}
    {modal === "product" && <div className="modal-overlay" role="presentation"><div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="new-product-title">
      <div className="modal-top"><div><span className="label-top">INVENTORY</span><h2 id="new-product-title">Add new product</h2></div><button className="icon-control" aria-label="Close" disabled={busy} onClick={() => setModal(null)}><X size={20}/></button></div>
      <form onSubmit={createProduct}>
        <div className="modal-content"><div className="form-grid">
          {([
            ["name", "Product name", "Milk powder 400g"], ["sku", "SKU", "SKU-1001"], ["barcode", "Barcode (optional)", "479..."],
            ["category", "Category", "Groceries"], ["price", "Selling price (LKR)", "850.00"], ["cost", "Cost price (LKR)", "600.00"],
            ["stock", "Opening stock units", "10"]
          ] as const).map(([key, title, placeholder]) => <label key={key} className={key === "name" ? "full-row" : ""}>{title}
            <input value={newProduct[key]} placeholder={placeholder} required={key !== "barcode"} onChange={e => setNewProduct(current => ({ ...current, [key]: e.target.value }))}/>
          </label>)}
        </div></div>
        <div className="modal-actions"><button type="button" className="secondary-action" disabled={busy} onClick={() => setModal(null)}>Cancel</button>
          <button type="submit" disabled={busy} className="primary-action">{busy ? "Saving…" : "Create product"}<Plus size={17}/></button></div>
      </form>
    </div></div>}
    {lastReceipt && <div className="receipt-toast"><CheckCircle2 size={21}/><div><strong>Payment recorded</strong><small>{lastReceipt.receiptNumber}</small></div>
      <button onClick={() => window.print()}><Printer size={16}/> Print</button><button className="icon-control" aria-label="Dismiss receipt" onClick={() => setLastReceipt(null)}><X size={16}/></button></div>}
    {lastReceipt && <div className="receipt-print" aria-hidden="true"><h2>FORMA POS</h2><p>Demo Store · Cash sale receipt</p>
      <p>{lastReceipt.receiptNumber}<br/>{new Date(lastReceipt.createdAt).toLocaleString("en-LK")}</p><hr/>
      {lastReceipt.items.map((line, i) => <div key={i} className="receipt-item"><span>{line.productName} × {line.quantity}</span><span>{formatMoney(line.lineTotalCents)}</span></div>)}
      <hr/><div className="receipt-item"><strong>TOTAL</strong><strong>{formatMoney(lastReceipt.totalCents)}</strong></div>
      <div className="receipt-item"><span>Cash</span><span>{formatMoney(lastReceipt.receivedCents)}</span></div>
      <div className="receipt-item"><span>Change</span><span>{formatMoney(lastReceipt.changeCents)}</span></div><hr/><p>Thank you for shopping!</p><p>DEVELOPMENT DEMO — NOT A FISCAL RECEIPT</p></div>}
  </div>;
}

function ShoppingBagIcon() { return <ShoppingCart size={22}/>; }

function Stat({ title, value, icon: Icon, tone }: { title: string; value: string; icon: typeof Package; tone: string }) {
  return <div className="stat-card"><span className={"stat-icon " + tone}><Icon size={22}/></span><span>{title}</span><strong>{value}</strong></div>;
}
function SalesTable({ sales }: { sales: SaleSummary[] }) {
  return <div className="table-scroll"><table><thead><tr><th>Receipt</th><th>Date</th><th>Lines</th><th>Payment</th><th className="align-right">Total</th></tr></thead>
    <tbody>{sales.map(sale => <tr key={sale.id}><td className="table-strong mono">{sale.receiptNumber}</td><td>{new Date(sale.createdAt).toLocaleString("en-LK")}</td>
      <td>{sale.lines}</td><td><span className="stock-pill">Cash</span></td><td className="table-strong align-right">{formatMoney(sale.totalCents)}</td></tr>)}</tbody></table>
    {!sales.length && <div className="table-empty">No recorded sales yet. Complete a sale at the POS to see it here.</div>}</div>;
}


type ShiftRow = {
  id: string; status: string; openedByName: string; openedAt: string;
  openingFloatCents: number; countedCashCents: number | null;
  expectedCashCents: number | null; varianceCents: number | null;
};
type ShiftSummary = {
  active: (ShiftRow & { salesCents: number; movementCents: number; expectedCashCents: number }) | null;
  history: ShiftRow[];
};
function CashShiftPanel() {
  const [snapshot, setSnapshot] = useState<ShiftSummary>({active:null,history:[]});
  const [amount, setAmount] = useState("0.00");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [warning,setWarning] = useState("");
  const [pendingRequestId, setPendingRequestId] = useState("");
  useEffect(()=>{
    let cancelled=false;
    void fetch("/api/shifts",{cache:"no-store"}).then(r=>readJson<ShiftSummary>(r))
      .then(data=>{if(!cancelled)setSnapshot(data);})
      .catch(e=>{if(!cancelled)setWarning(e instanceof Error?e.message:"Could not load shifts.");});
    return ()=>{cancelled=true;};
  },[]);
  async function reload() {
    const data=await fetch("/api/shifts",{cache:"no-store"}).then(r=>readJson<ShiftSummary>(r));
    setSnapshot(data);
  }
  async function execute(action:"open"|"close"|"CASH_IN"|"CASH_OUT"){
    if(busy)return;
    const cents=parseMoney(amount);
    if(cents===null || (action==="CASH_IN"||action==="CASH_OUT")&&cents===0){
      setWarning("Enter a valid cash amount.");return;
    }
    if(action==="close" && !window.confirm("Close this shift with counted cash "+formatMoney(cents)+"?"))return;
    if((action==="CASH_IN"||action==="CASH_OUT") && note.trim().length<2){
      setWarning("Enter a cash movement reason (at least 2 characters).");return;
    }
    setBusy(true);setWarning("");
    const requestId=pendingRequestId || crypto.randomUUID();
    if(action==="CASH_IN"||action==="CASH_OUT")setPendingRequestId(requestId);
    try {
      await fetch("/api/shifts",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(action==="open"?{action:"open",openingFloatCents:cents}:
          action==="close"?{action:"close",countedCashCents:cents}:
          {action:"movement",requestId,type:action,amountCents:cents,note:note.trim()})
      }).then(r=>readJson(r));
      setPendingRequestId("");setNote("");setAmount("0.00");
      await reload();
    } catch(e) {
      setWarning((e instanceof Error?e.message:"Shift update not confirmed.")+
        " Refresh and verify register status before creating another request.");
    }finally{setBusy(false);}
  }
  return <>
    <div className="content-heading"><div><h2>Cash register 01</h2>
      <p>Local development register · cash movements and reconciliation</p></div>
      <span className="subtle-pill">{snapshot.active?"Shift open":"No active shift"}</span></div>
    <div className="stat-grid">
      <Stat title="Opening float" value={formatMoney(snapshot.active?.openingFloatCents??0)} icon={Wallet} tone="green"/>
      <Stat title="Cash sales" value={formatMoney(snapshot.active?.salesCents??0)} icon={TrendingUp} tone="blue"/>
      <Stat title="Cash in / out" value={formatMoney(snapshot.active?.movementCents??0)} icon={Activity} tone="violet"/>
      <Stat title="Expected drawer" value={formatMoney(snapshot.active?.expectedCashCents??0)} icon={ReceiptText} tone="amber"/>
    </div>
    <div className="panel" style={{padding:20,marginBottom:20}}>
      <div className="panel-header" style={{padding:0,paddingBottom:18}}><h3>{snapshot.active?"Shift actions":"Open a new shift"}</h3></div>
      <p style={{color:"#8390a1",fontSize:12,marginTop:16}}>{snapshot.active
        ?"Started by "+snapshot.active.openedByName+" · "+new Date(snapshot.active.openedAt).toLocaleString("en-LK")
        :"Enter opening float and start the register before taking cash sales."}</p>
      <label className="field-label" htmlFor="shift-amount">{snapshot.active?"Cash amount / counted cash (LKR)":"Opening float (LKR)"}</label>
      <input className="money-input" id="shift-amount" value={amount} disabled={busy||!!pendingRequestId}
        onChange={e=>setAmount(e.target.value)} inputMode="decimal"/>
      {snapshot.active && <><label className="field-label" htmlFor="shift-note">Cash-in / cash-out reason</label>
        <input id="shift-note" className="money-input" style={{fontSize:13}} value={note}
          disabled={busy||!!pendingRequestId} onChange={e=>setNote(e.target.value)} placeholder="e.g. Petty cash"/></>}
      {warning && <p className="form-error" role="alert">{warning}</p>}
      <div className="stock-actions" style={{gap:10,marginTop:18}}>
        {!snapshot.active?<button disabled={busy} onClick={()=>void execute("open")}>Open shift</button>:
          <>
            <button disabled={busy} onClick={()=>void execute("CASH_IN")}>Cash in</button>
            <button disabled={busy} onClick={()=>void execute("CASH_OUT")}>Cash out</button>
            <button disabled={busy||!!pendingRequestId} onClick={()=>void execute("close")}>Close and reconcile</button>
          </>}
        <button type="button" disabled={busy} onClick={()=>void reload()}>Refresh</button>
      </div>
    </div>
    <div className="panel"><div className="panel-header"><h3>Shift history</h3><span className="subtle-pill">Last 20 shifts</span></div>
      <div className="table-scroll"><table><thead><tr><th>Started</th><th>Cashier</th><th>Status</th><th>Expected</th><th>Counted</th><th>Variance</th></tr></thead>
        <tbody>{snapshot.history.map(shift=><tr key={shift.id}>
          <td>{new Date(shift.openedAt).toLocaleString("en-LK")}</td><td>{shift.openedByName}</td>
          <td>{shift.status}</td><td>{shift.expectedCashCents===null?"—":formatMoney(shift.expectedCashCents)}</td>
          <td>{shift.countedCashCents===null?"—":formatMoney(shift.countedCashCents)}</td>
          <td>{shift.varianceCents===null?"—":formatMoney(shift.varianceCents)}</td>
        </tr>)}</tbody></table></div>
    </div>
    <p className="small-disclaimer" style={{marginTop:15}}>
      Demo only: one register, cash payments only. Expected cash excludes sales before a shift was opened.
      No refunds, denomination counts, over/short approvals or fiscal certification.
    </p>
  </>;
}
