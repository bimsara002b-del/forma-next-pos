"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, Banknote, Barcode, CheckCircle2, ChevronDown, CreditCard,
  Keyboard, Minus, PackageOpen, Plus, Printer, Search, ShoppingBag,
  ShoppingCart, Trash2, X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { formatMoney, moneyInputToCents } from "@/lib/money";

type Product = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  priceCents: number;
  stockQty: number;
};
type CartEntry = { productId: string; quantity: number };
type Receipt = {
  id: string;
  receiptNumber: string;
  totalCents: number;
  amountReceivedCents: number;
  changeCents: number;
  paymentMethod: string;
  createdAt: string;
  items: { productName: string; quantity: number; unitPriceCents: number; lineTotalCents: number }[];
};

const categoryIcons: Record<string, string> = {
  Groceries: "🛒", Dairy: "🥛", Bakery: "🍞", Beverages: "☕", Household: "🧴",
};

export default function PosPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All products");
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "CARD">("CASH");
  const [receivedInput, setReceivedInput] = useState("0.00");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadProducts = useCallback(async () => {
    try {
      const response = await fetch("/api/products", { cache: "no-store" });
      const data: { products?: Product[]; error?: string } = await response.json();
      if (!response.ok || !data.products) throw new Error(data.error ?? "Cannot load products");
      setProducts(data.products);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to connect to the database");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadProducts(); }, [loadProducts]);

  const categories = useMemo(() => ["All products", ...new Set(products.map((item) => item.category))], [products]);
  const filteredProducts = useMemo(() => products.filter((product) => {
    if (category !== "All products" && product.category !== category) return false;
    const query = search.trim().toLowerCase();
    return !query || [product.name, product.sku, product.barcode ?? ""].some((field) => field.toLowerCase().includes(query));
  }), [category, products, search]);
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const cartLines = useMemo(() => cart.flatMap((entry) => {
    const product = productById.get(entry.productId);
    return product ? [{ product, quantity: entry.quantity, lineTotalCents: product.priceCents * entry.quantity }] : [];
  }), [cart, productById]);
  const totalCents = cartLines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const itemCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);

  const addToCart = useCallback((product: Product) => {
    setMessage("");
    setCart((previous) => {
      const existing = previous.find((entry) => entry.productId === product.id);
      if ((existing?.quantity ?? 0) >= product.stockQty) return previous;
      if (existing) return previous.map((entry) => entry.productId === product.id ? { ...entry, quantity: entry.quantity + 1 } : entry);
      return [...previous, { productId: product.id, quantity: 1 }];
    });
  }, []);

  const changeQuantity = useCallback((productId: string, delta: number) => {
    setCart((previous) => previous.flatMap((entry) => {
      if (entry.productId !== productId) return [entry];
      const updated = entry.quantity + delta;
      const available = productById.get(productId)?.stockQty ?? 0;
      return updated <= 0 ? [] : [{ ...entry, quantity: Math.min(updated, available) }];
    }));
  }, [productById]);

  const openCheckout = useCallback(() => {
    if (!cart.length || submitting) return;
    setMessage("");
    setPaymentMethod("CASH");
    setReceivedInput((totalCents / 100).toFixed(2));
    setCheckoutOpen(true);
  }, [cart.length, submitting, totalCents]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "F2") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "F4" && !checkoutOpen) {
        event.preventDefault();
        openCheckout();
      } else if (event.key === "Escape" && checkoutOpen && !submitting) {
        setCheckoutOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [checkoutOpen, openCheckout, submitting]);

  const scanOrSearch = () => {
    const exact = products.find((product) => product.barcode === search.trim() || product.sku.toLowerCase() === search.trim().toLowerCase());
    const result = exact ?? (filteredProducts.length === 1 ? filteredProducts[0] : null);
    if (!result) return;
    addToCart(result);
    setSearch("");
  };

  const receivedCents = moneyInputToCents(receivedInput);
  const changeCents = paymentMethod === "CASH" && receivedCents !== null ? Math.max(0, receivedCents - totalCents) : 0;
  const isPaymentValid = paymentMethod === "CARD" || (receivedCents !== null && receivedCents >= totalCents);

  const completeSale = async () => {
    if (submitting || !isPaymentValid || cart.length === 0) return;
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map(({ productId, quantity }) => ({ productId, quantity })),
          paymentMethod,
          amountReceivedCents: paymentMethod === "CARD" ? totalCents : receivedCents,
        }),
      });
      const data: { sale?: Receipt; error?: string } = await response.json();
      if (!response.ok || !data.sale) throw new Error(data.error ?? "Checkout failed");
      setReceipt(data.sale);
      setMessage(`Sale ${data.sale.receiptNumber} saved successfully.`);
      setCart([]);
      setCheckoutOpen(false);
      await loadProducts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checkout failed");
    } finally {
      setSubmitting(false);
    }
  };

  return <>
    <div id="app-display"><AppShell active="pos">
      <header className="pos-topbar">
        <div><div className="eyebrow">SALES WORKSPACE <span className="crumb-divider">/</span> CHECKOUT</div><h1>Point of sale <span className="topbar-counter">{products.length} products</span></h1></div>
        <div className="topbar-right"><span className="branch"><span className="branch-avatar">F</span><span><strong>Forma Demo Store</strong><small>Register 01</small></span><ChevronDown size={16}/></span><span className="live-indicator"><span/> DEMO</span></div>
      </header>
      {message && <div className="message-banner" role="status">{message}<button type="button" aria-label="Dismiss notice" onClick={() => setMessage("")}><X size={16}/></button></div>}
      <div className="pos-workspace">
        <section className="catalog-area" aria-label="Product catalog">
          <div className="section-toolbar">
            <div><h2>Products</h2><p>Find products and add to the order</p></div>
            <span className="keyboard-hint"><Keyboard size={16}/> F2 Search</span>
          </div>
          <label className="search-wrap"><Search size={19} color="#8b93a5"/><input ref={searchRef} aria-label="Search products by name, SKU, or barcode" placeholder="Search by product, SKU or barcode..." value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); scanOrSearch(); } }}/><span className="scan-icon"><Barcode size={20}/></span></label>
          <div className="categories" aria-label="Product categories">{categories.map((entry) => <button type="button" key={entry} className={`category-tab ${category === entry ? "selected" : ""}`} aria-pressed={category === entry} onClick={() => setCategory(entry)}>{entry}</button>)}</div>
          <div className="catalog-list-title"><span>{category}</span><small>{filteredProducts.length} items</small></div>
          <div className="products-scroll"><div className="product-grid">
            {filteredProducts.map((product) => {
              const inCart = cart.find((entry) => entry.productId === product.id)?.quantity ?? 0;
              const out = inCart >= product.stockQty;
              return <button key={product.id} type="button" className={`product-card ${out ? "unavailable" : ""}`} onClick={() => addToCart(product)} disabled={out} aria-label={`Add ${product.name}, ${formatMoney(product.priceCents)}`}>
                <span className={`product-picture picture-${product.category.toLowerCase()}`} role="img" aria-label={product.category}>{categoryIcons[product.category] ?? "📦"}</span>
                <span className="product-category">{product.category}</span><strong>{product.name}</strong>
                <span className="product-bottom"><span className="product-price">{formatMoney(product.priceCents)}</span><span className="add-product"><Plus size={17}/></span></span>
                <span className={`stock-text ${product.stockQty <= 5 ? "low" : ""}`}>{product.stockQty === 0 ? "Out of stock" : `${product.stockQty} in stock`}</span>
              </button>;
            })}
          </div>
          {!loading && filteredProducts.length === 0 && <div className="catalog-empty"><PackageOpen size={36}/><strong>No matching products</strong><span>Try a different search or run the seed command.</span></div>}
          {loading && <p className="loading-text">Loading product catalog...</p>}
          </div>
        </section>
        <aside className="cart-area" aria-label="Current order">
          <div className="cart-head"><div className="cart-head-icon"><ShoppingBag size={20}/></div><div><h2>Current order</h2><p>New sale · Cashier demo</p></div><span className="cart-count">{itemCount} items</span></div>
          <div className="cart-subhead"><span>ORDER ITEMS</span>{cart.length > 0 && <button type="button" onClick={() => setCart([])}><Trash2 size={14}/> Clear all</button>}</div>
          <div className="cart-items">
            {cartLines.length === 0 ? <div className="cart-empty"><div className="cart-empty-icon"><ShoppingCart size={27}/></div><strong>Your cart is empty</strong><p>Click a product or scan a barcode to start the sale.</p></div> : cartLines.map(({ product, quantity, lineTotalCents }) => <div className="cart-line" key={product.id}>
              <span className="cart-product-icon">{categoryIcons[product.category] ?? "📦"}</span>
              <div className="cart-product-body"><div className="cart-line-first"><strong>{product.name}</strong><span>{formatMoney(lineTotalCents)}</span></div><small>{formatMoney(product.priceCents)} each</small><div className="qty-control"><button type="button" onClick={() => changeQuantity(product.id, -1)} aria-label={`Remove one ${product.name}`}><Minus size={14}/></button><span>{quantity}</span><button type="button" onClick={() => changeQuantity(product.id, 1)} disabled={quantity >= product.stockQty} aria-label={`Add one ${product.name}`}><Plus size={14}/></button></div></div>
            </div>)}
          </div>
          <div className="cart-footer">
            <div className="price-row"><span>Subtotal</span><span>{formatMoney(totalCents)}</span></div>
            <div className="price-row muted"><span>Discount</span><span>—</span></div>
            <div className="price-row muted"><span>Tax</span><span>Not configured</span></div>
            <div className="total-row"><span>Total amount</span><strong>{formatMoney(totalCents)}</strong></div>
            <button type="button" className="checkout-button" onClick={openCheckout} disabled={cart.length === 0 || submitting}>Proceed to checkout <ArrowRight size={19}/></button>
            <div className="footer-hint"><Keyboard size={14}/> Press F4 to checkout</div>
          </div>
        </aside>
      </div>
    </AppShell></div>

    {checkoutOpen && <div className="modal-overlay" role="presentation"><div className="checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-heading">
      <div className="modal-header"><div><div className="eyebrow">COMPLETE TRANSACTION</div><h2 id="checkout-heading">Checkout</h2></div><button type="button" className="icon-button" aria-label="Close checkout" onClick={() => setCheckoutOpen(false)} disabled={submitting}><X size={21}/></button></div>
      <div className="modal-body"><div className="checkout-grand-total"><small>AMOUNT DUE</small><strong>{formatMoney(totalCents)}</strong><span>{itemCount} item{itemCount === 1 ? "" : "s"} in your order</span></div>
      <p className="field-label">Payment method</p><div className="payment-methods"><button type="button" className={`payment-method ${paymentMethod === "CASH" ? "selected" : ""}`} onClick={() => setPaymentMethod("CASH")}><Banknote size={21}/> Cash</button><button type="button" className={`payment-method ${paymentMethod === "CARD" ? "selected" : ""}`} onClick={() => setPaymentMethod("CARD")}><CreditCard size={21}/> Card (record only)</button></div>
      {paymentMethod === "CASH" ? <><label htmlFor="cash-received" className="field-label">Cash received (LKR)</label><input id="cash-received" className="cash-input" inputMode="decimal" value={receivedInput} onChange={(e) => setReceivedInput(e.target.value)} /><div className="change-row"><span>Change due</span><strong>{formatMoney(changeCents)}</strong></div>{!isPaymentValid && <p className="payment-error">Enter a valid cash amount that covers the order total.</p>}</> : <p className="payment-warning">This records a card sale only. No payment is sent to a bank or card terminal.</p>}
      </div><div className="modal-footer"><button type="button" className="cancel-button" onClick={() => setCheckoutOpen(false)} disabled={submitting}>Cancel</button><button type="button" className="confirm-button" disabled={!isPaymentValid || submitting} onClick={() => void completeSale()}><CheckCircle2 size={19}/> {submitting ? "Saving..." : "Complete sale"}</button></div>
    </div></div>}

    {receipt && <div className="receipt-floating"><div className="receipt-floating-icon"><CheckCircle2 size={20}/></div><div><strong>Sale completed</strong><small>{receipt.receiptNumber}</small></div><button type="button" onClick={() => window.print()}><Printer size={16}/> Print receipt</button><button type="button" aria-label="Dismiss receipt notification" className="icon-button" onClick={() => setReceipt(null)}><X size={16}/></button></div>}

    {receipt && <div className="receipt-print">
      <h2>FORMA POS</h2><p>DEVELOPMENT DEMO RECEIPT</p><p>{receipt.receiptNumber}<br/>{new Date(receipt.createdAt).toLocaleString("en-LK")}</p><hr/>
      {receipt.items.map((item, index) => <div className="receipt-line" key={index}><span>{item.productName}<br/>{item.quantity} × {formatMoney(item.unitPriceCents)}</span><span>{formatMoney(item.lineTotalCents)}</span></div>)}
      <hr/><div className="receipt-line"><strong>TOTAL</strong><strong>{formatMoney(receipt.totalCents)}</strong></div><div className="receipt-line"><span>Paid ({receipt.paymentMethod})</span><span>{formatMoney(receipt.amountReceivedCents)}</span></div><div className="receipt-line"><span>Change</span><span>{formatMoney(receipt.changeCents)}</span></div><hr/><p>Thank you!</p><p>Not a legally compliant tax invoice.</p>
    </div>}
  </>;
}
