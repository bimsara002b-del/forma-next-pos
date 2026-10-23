"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { formatMoney, parseMoney } from "@/lib/money";

type Item = {
  id: string; name: string; sku: string; barcode: string | null; category: string;
  priceCents: number; costCents: number; stockQty: number; minStockQty: number;
  isActive: boolean;
};
type ReceiptRow = {
  id: string; reference: string; supplierName: string; createdAt: string; purchaseOrderId?: string | null;
  lines: { productName: string; quantity: number; unitCostCents: number }[];
};
type MovementRow = {
  id: string; reason: string; changeQty: number; reference: string | null;
  createdAt: string; product: { name: string };
};
type InventoryData = { products: Item[]; recentReceipts: ReceiptRow[]; movements: MovementRow[] };
type ReceiveLine = { key: number; productId: string; quantity: string; unitCost: string };
type ReceivePayload = {
  action: "receive"; requestId: string; supplierName: string; reference: string;
  lines: { productId: string; quantity: number; unitCostCents: number }[];
};
type ProductDraft = {
  name: string; sku: string; barcode: string; category: string; price: string;
  cost: string; minStock: string;
};
const currency = (cents: number) => (cents / 100).toFixed(2);
const draftFrom = (product: Item): ProductDraft => ({
  name: product.name, sku: product.sku, barcode: product.barcode ?? "",
  category: product.category, price: currency(product.priceCents),
  cost: currency(product.costCents), minStock: String(product.minStockQty)
});
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Request could not be completed.");
  return body as T;
}

export function AdvancedInventory({ onUpdated }: { onUpdated: () => Promise<void> }) {
  const [data, setData] = useState<InventoryData>({ products: [], recentReceipts: [], movements: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<ReceiveLine[]>([{key:1,productId:"",quantity:"1",unitCost:"0.00"}]);
  const [pendingReceipt, setPendingReceipt] = useState<ReceivePayload | null>(null);
  const [editId, setEditId] = useState("");
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [countId, setCountId] = useState("");
  const [countedQty, setCountedQty] = useState("");
  const [countReason, setCountReason] = useState("Physical stock count");
  const refresh = useCallback(async () => {
    const next = await requestJson<InventoryData>("/api/inventory?includeInactive=true");
    setData(next);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void requestJson<InventoryData>("/api/inventory?includeInactive=true")
      .then(next => { if (!cancelled) setData(next); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load inventory."); });
    return () => { cancelled = true; };
  }, []);
  const active = data.products.filter(product => product.isActive);
  const editing = data.products.find(product => product.id === editId) ?? null;
  const counted = data.products.find(product => product.id === countId) ?? null;
  const inputStyle = { width: "100%", padding: "10px 12px", border: "1px solid #dce4ea", borderRadius: 8 };
  const buttons = { display: "flex", gap: 8, flexWrap: "wrap" as const, marginTop: 12 };

  async function afterChange(message: string) {
    await Promise.all([refresh(), onUpdated()]);
    setNotice(message);
  }

  function makeReceipt(): ReceivePayload {
    const parsed = lines.map(line => ({
      productId: line.productId,
      quantity: Number(line.quantity),
      unitCostCents: parseMoney(line.unitCost)
    }));
    if (!supplier.trim() || !reference.trim() || supplier.trim().length < 2 ||
      reference.trim().length < 2 || parsed.some(line => !line.productId ||
      !Number.isSafeInteger(line.quantity) || line.quantity <= 0 || line.quantity > 100000 ||
      line.unitCostCents === null || line.unitCostCents > 100000000) ||
      new Set(parsed.map(line => line.productId)).size !== parsed.length) {
      throw new Error("Enter a supplier, invoice reference, and unique products with valid quantities and costs.");
    }
    return { action: "receive", requestId: crypto.randomUUID(),
      supplierName: supplier.trim(), reference: reference.trim(),
      lines: parsed.map(line => ({ productId: line.productId, quantity: line.quantity,
        unitCostCents: line.unitCostCents! })) };
  }
  async function submitReceipt(payload: ReceivePayload) {
    setPendingReceipt(payload);
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/inventory", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) {
        // A failed validation/conflict cannot be an ambiguous successful transaction.
        if (response.status < 500) setPendingReceipt(null);
        throw new Error(result.error ?? "Could not confirm receiving.");
      }
      setPendingReceipt(null);
      setSupplier(""); setReference("");
      setLines([{key:Date.now(),productId:"",quantity:"1",unitCost:"0.00"}]);
      await afterChange(result.replay ? "Existing receiving receipt confirmed (no duplicate stock)." :
        "Receiving posted to inventory and movement history.");
    } catch(e) {
      setError((e instanceof Error ? e.message : "Receiving status unknown.") +
        (pendingReceipt || payload ? " If the request may have reached the server, retry the SAME receiving request rather than creating another." : ""));
    } finally { setBusy(false); }
  }
  async function receive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || pendingReceipt) return;
    try { await submitReceipt(makeReceipt()); }
    catch(e) { setError(e instanceof Error ? e.message : "Invalid receiving form."); }
  }
  async function changeProduct(action: "edit" | "archive" | "restore", product: Item) {
    if (busy) return;
    let payload: Record<string, string | number | null> = { action };
    if (action === "edit") {
      if (!draft || product.id !== editId) return;
      const priceCents = parseMoney(draft.price), costCents = parseMoney(draft.cost);
      const minStockQty = Number(draft.minStock);
      if (priceCents === null || priceCents <= 0 || costCents === null ||
        !Number.isSafeInteger(minStockQty) || minStockQty < 0 || minStockQty > 1000000) {
        setError("Enter valid price, cost and low-stock threshold."); return;
      }
      payload = { action, name: draft.name, sku: draft.sku, barcode: draft.barcode.trim() || null,
        category: draft.category, priceCents, costCents, minStockQty };
    } else if (!window.confirm((action === "archive" ? "Archive " : "Restore ") + product.name + "?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await requestJson("/api/products/" + encodeURIComponent(product.id), {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      if (action === "edit") { setEditId(""); setDraft(null); }
      await afterChange("Product " + (action === "edit" ? "updated" : action === "archive" ? "archived" : "restored") + ".");
    } catch(e) { setError(e instanceof Error ? e.message : "Could not update product."); }
    finally { setBusy(false); }
  }
  async function reconcile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!counted || busy) return;
    const quantity = Number(countedQty);
    if (!/^\d{1,7}$/.test(countedQty) || !Number.isSafeInteger(quantity) || quantity > 1000000) {
      setError("Enter a whole-number counted quantity."); return;
    }
    if (!window.confirm("Save physical count for " + counted.name + "?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await requestJson("/api/inventory", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "count", productId: counted.id,
          expectedQty: counted.stockQty, countedQty: quantity, reason: countReason.trim() }) });
      setCountId(""); setCountedQty("");
      await afterChange("Physical stock count reconciled.");
    } catch(e) { setError(e instanceof Error ? e.message : "Count could not be saved. Refresh inventory."); }
    finally { setBusy(false); }
  }

  return <section style={{ marginTop: 26 }} aria-label="Advanced inventory controls">
    <div className="content-heading"><div>
      <h2>Advanced Inventory</h2><p>Receiving, product maintenance and physical stock counting</p>
    </div><button type="button" className="small-action" disabled={busy} onClick={() => void refresh()}>Refresh history</button></div>
    {error && <div className="form-error" role="alert" style={{marginBottom:16}}>{error}</div>}
    {notice && <p role="status" style={{color:"#16835b"}}>{notice}</p>}
    <div className="panel" style={{padding:20,marginBottom:20}}>
      <h3>Receive purchased products</h3>
      <p className="small-disclaimer">Receiving updates stock and latest cost, preserving a supplier and invoice reference.</p>
      <form onSubmit={e => void receive(e)}>
        <div className="form-grid">
          <label>Supplier name<input required maxLength={100} style={inputStyle} disabled={busy || !!pendingReceipt}
            value={supplier} onChange={e => setSupplier(e.target.value)}/></label>
          <label>Invoice / reference<input required maxLength={80} style={inputStyle} disabled={busy || !!pendingReceipt}
            value={reference} onChange={e => setReference(e.target.value)}/></label>
        </div>
        {lines.map((line, index) => <div key={line.key} className="form-grid" style={{marginTop:12}}>
          <label>Product {index+1}
            <select required style={inputStyle} value={line.productId} disabled={busy || !!pendingReceipt}
              onChange={e => setLines(old => old.map(row => row.key === line.key ? {...row,productId:e.target.value} : row))}>
              <option value="">Select product</option>{active.map(product =>
                <option key={product.id} value={product.id}>{product.name} ({product.sku})</option>)}
            </select>
          </label>
          <label>Quantity<input required min="1" max="100000" step="1" type="number"
            style={inputStyle} value={line.quantity} disabled={busy || !!pendingReceipt}
            onChange={e => setLines(old => old.map(row => row.key === line.key ? {...row,quantity:e.target.value} : row))}/></label>
          <label>Unit cost (LKR)<input required inputMode="decimal" style={inputStyle}
            value={line.unitCost} disabled={busy || !!pendingReceipt}
            onChange={e => setLines(old => old.map(row => row.key === line.key ? {...row,unitCost:e.target.value} : row))}/></label>
          <div style={{display:"flex",alignItems:"end"}}><button type="button" disabled={busy || !!pendingReceipt || lines.length===1}
            onClick={() => setLines(old => old.filter(row => row.key !== line.key))}>Remove line</button></div>
        </div>)}
        <div style={buttons}>
          <button type="button" disabled={busy || !!pendingReceipt || lines.length>=40}
            onClick={() => setLines(old => [...old,{key:Date.now()+Math.random(),productId:"",quantity:"1",unitCost:"0.00"}])}>Add product line</button>
          <button type="submit" className="small-action" disabled={busy || !!pendingReceipt}>
            {busy ? "Saving…" : "Save receiving"}</button>
          {pendingReceipt && <button type="button" className="small-action" disabled={busy}
            onClick={() => void submitReceipt(pendingReceipt)}>Retry SAME receipt</button>}
        </div>
        {pendingReceipt && <p role="status" style={{marginTop:12,color:"#ab5d12"}}>
          Receiving result may be uncertain. The form is locked; retry preserves the same request ID and items.
        </p>}
      </form>
    </div>
    <div className="panel" style={{padding:20,marginBottom:20}}>
      <h3>Edit / archive a product</h3>
      <label className="field-label" htmlFor="inventory-edit-product">Product (including archived)</label>
      <select id="inventory-edit-product" style={inputStyle} value={editId} disabled={busy} onChange={e => {
        const product=data.products.find(p => p.id === e.target.value);
        setEditId(e.target.value); setDraft(product ? draftFrom(product) : null);
      }}><option value="">Choose a product</option>{data.products.map(product =>
        <option key={product.id} value={product.id}>{product.name} {product.isActive?"":"(archived)"}</option>)}</select>
      {editing && draft && <>
        <div className="form-grid" style={{marginTop:14}}>
          {(["name","sku","barcode","category","price","cost","minStock"] as const).map(field =>
            <label key={field}>{field==="minStock"?"Low-stock threshold":field==="price"?"Selling price (LKR)":
              field==="cost"?"Unit cost (LKR)":field}
              <input style={inputStyle} value={draft[field]} disabled={busy}
                onChange={e => setDraft(old => old ? {...old,[field]:e.target.value} : old)}/></label>)}
        </div>
        <div style={buttons}>
          <button type="button" className="small-action" disabled={busy}
            onClick={() => void changeProduct("edit",editing)}>Save product changes</button>
          <button type="button" disabled={busy} onClick={() => void changeProduct(
            editing.isActive?"archive":"restore",editing)}>{editing.isActive?"Archive product":"Restore product"}</button>
        </div>
      </>}
    </div>
    <div className="panel" style={{padding:20,marginBottom:20}}>
      <h3>Physical stock count</h3><p className="small-disclaimer">If another sale changes stock while counting, the server rejects the outdated count.</p>
      <form onSubmit={e => void reconcile(e)}>
        <div className="form-grid">
          <label>Active product<select style={inputStyle} value={countId} disabled={busy}
            onChange={e => { const p=data.products.find(p => p.id===e.target.value); setCountId(e.target.value);setCountedQty(p?String(p.stockQty):""); }}>
            <option value="">Select product</option>{active.map(product =>
              <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
          <label>Current system quantity<input readOnly style={inputStyle} value={counted?.stockQty??""}/></label>
          <label>Counted physical quantity<input style={inputStyle} required inputMode="numeric" value={countedQty}
            disabled={!counted || busy} onChange={e => setCountedQty(e.target.value)}/></label>
          <label>Reason<input required minLength={3} maxLength={120} style={inputStyle} value={countReason}
            disabled={!counted || busy} onChange={e => setCountReason(e.target.value)}/></label>
        </div>
        <button type="submit" className="small-action" style={{marginTop:12}} disabled={!counted||busy}>Reconcile stock</button>
      </form>
    </div>
    <div className="panel" style={{marginBottom:20}}>
      <div className="panel-header"><h3>Purchase receiving history</h3><span className="subtle-pill">Latest 25</span></div>
      <div className="table-scroll"><table><thead><tr><th>Invoice</th><th>Supplier</th><th>Date</th><th>Items received</th></tr></thead>
        <tbody>{data.recentReceipts.map(receipt => <tr key={receipt.id}>
          <td className="table-strong">{receipt.reference}{receipt.purchaseOrderId ? " (PO linked)" : ""}</td><td>{receipt.supplierName}</td>
          <td>{new Date(receipt.createdAt).toLocaleString("en-LK")}</td><td>{receipt.lines.map(line =>
            line.productName+" × "+line.quantity+" ("+formatMoney(line.unitCostCents)+")").join(", ")}</td>
        </tr>)}</tbody></table>{!data.recentReceipts.length && <p className="table-empty">No receiving records yet.</p>}</div>
    </div>
    <div className="panel">
      <div className="panel-header"><h3>Recent stock movement ledger</h3><span className="subtle-pill">Latest 30</span></div>
      <div className="table-scroll"><table><thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Quantity change</th><th>Reference</th></tr></thead>
        <tbody>{data.movements.map(movement => <tr key={movement.id}>
          <td>{new Date(movement.createdAt).toLocaleString("en-LK")}</td>
          <td>{movement.product.name}</td><td>{movement.reason}</td>
          <td>{movement.changeQty>0?"+":""}{movement.changeQty}</td><td>{movement.reference??"—"}</td>
        </tr>)}</tbody></table>{!data.movements.length && <p className="table-empty">No movements yet.</p>}</div>
    </div>
  </section>;
}
