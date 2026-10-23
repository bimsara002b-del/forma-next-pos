"use client";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { formatMoney, parseMoney } from "@/lib/money";
type Supplier={id:string;name:string;isActive:boolean};
type Item={id:string;name:string;sku:string;stockQty:number;minStockQty:number;costCents:number;recommendedQty?:number};
type Order={id:string;orderNumber:string;status:string;createdAt:string;supplier:Supplier;lines:{id:string;quantityOrdered:number;quantityReceived:number;unitCostCents:number;product:{name:string}}[]};
type Snapshot={suppliers:Supplier[];orders:Order[];lowStock:Item[];lowStockTruncated:boolean};
type Catalog={products:Item[]};
async function json<T>(path:string, init?:RequestInit):Promise<T>{
  const response=await fetch(path,{cache:"no-store",...init});const data=await response.json();
  if(!response.ok)throw Error(data.error||"Request failed");return data as T;
}
export function ProcurementDashboard(){
  const [data,setData]=useState<Snapshot>({suppliers:[],orders:[],lowStock:[],lowStockTruncated:false});
  const [catalog,setCatalog]=useState<Item[]>([]);
  const [supplierName,setSupplierName]=useState("");
  const [supplierId,setSupplierId]=useState("");
  const [selectedProduct,setSelectedProduct]=useState("");
  const [quantity,setQuantity]=useState("1");
  const [unitCost,setUnitCost]=useState("0.00");
  const [notes,setNotes]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  async function refresh(){const [snapshot,products]=await Promise.all([json<Snapshot>("/api/procurement"),json<Catalog>("/api/products")]);setData(snapshot);setCatalog(products.products);}
  useEffect(()=>{let live=true;void Promise.all([json<Snapshot>("/api/procurement"),json<Catalog>("/api/products")]).then(([s,p])=>{if(live){setData(s);setCatalog(p.products);}}).catch(e=>{if(live)setError(String(e));});return()=>{live=false;};},[]);
  async function command(payload:object,done:string){
    setBusy(true);setError("");setMessage("");
    try{await json("/api/procurement",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});await refresh();setMessage(done);}
    catch(e){setError(e instanceof Error?e.message:"Request failed");}finally{setBusy(false);}
  }
  async function addSupplier(event:FormEvent){event.preventDefault();await command({action:"supplier-create",name:supplierName.trim()},"Supplier created.");setSupplierName("");}
  async function createOrder(event:FormEvent){event.preventDefault();
    const cost=parseMoney(unitCost),qty=Number(quantity);
    if(!supplierId||!selectedProduct||!Number.isSafeInteger(qty)||qty<1||cost===null){setError("Select supplier/product and enter valid cost/quantity.");return;}
    await command({action:"order-create",supplierId,notes,lines:[{productId:selectedProduct,quantityOrdered:qty,unitCostCents:cost}]},
      "Purchase order saved as DRAFT. No inventory was received.");
  }
  const style={padding:"10px 12px",border:"1px solid #dce4ea",borderRadius:8,width:"100%"} as const;
  return <main className="content-scroll" style={{maxWidth:1150,margin:"0 auto"}}>
    <div className="content-heading"><div><Link href="/" className="text-link">← Back to POS</Link>
      <h1 style={{marginTop:12}}>Procurement & Low Stock</h1><p>Local supplier and purchase-order planning · Demo only</p></div>
      <button className="small-action" disabled={busy} onClick={()=>void refresh()}>Refresh</button></div>
    {message&&<p role="status" style={{color:"#148657"}}>{message}</p>}
    {error&&<p role="alert" className="form-error">{error}</p>}
    <div className="panel" style={{padding:20,marginBottom:20}}>
      <h3>Low-stock alerts</h3><p className="small-disclaimer">Based on each product's reorder threshold. Suggestions are not orders.</p>
      <div className="table-scroll"><table><thead><tr><th>Product</th><th>On hand</th><th>Threshold</th><th>Suggested order</th></tr></thead>
        <tbody>{data.lowStock.map(p=><tr key={p.id}><td>{p.name}</td><td>{p.stockQty}</td><td>{p.minStockQty}</td><td>{p.recommendedQty}</td></tr>)}</tbody></table></div>
      {data.lowStockTruncated&&<p>Result capped; review larger catalogs separately.</p>}
    </div>
    <div className="panel" style={{padding:20,marginBottom:20}}>
      <h3>Add supplier</h3><form onSubmit={e=>void addSupplier(e)} style={{display:"flex",gap:12,alignItems:"end"}}>
        <label style={{flex:1}}>Supplier name<input style={style} required minLength={2} maxLength={100} value={supplierName} onChange={e=>setSupplierName(e.target.value)}/></label>
        <button className="small-action" disabled={busy}>Add supplier</button></form>
      <p className="small-disclaimer">{data.suppliers.length} suppliers recorded</p>
    </div>
    <div className="panel" style={{padding:20,marginBottom:20}}>
      <h3>Create purchase order</h3>
      <p className="small-disclaimer">A DRAFT order never increases stock. Receive items in the Inventory section after physical delivery.</p>
      <form onSubmit={e=>void createOrder(e)}><div className="form-grid">
        <label>Supplier<select required style={style} value={supplierId} onChange={e=>setSupplierId(e.target.value)}><option value="">Select supplier</option>
          {data.suppliers.filter(s=>s.isActive).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Product<select style={style} value={selectedProduct} required onChange={e=>{const id=e.target.value;setSelectedProduct(id);const p=catalog.find(x=>x.id===id);if(p)setUnitCost((p.costCents/100).toFixed(2));}}>
          <option value="">Choose product</option>{catalog.map(p=><option value={p.id} key={p.id}>{p.name} ({p.sku})</option>)}</select></label>
        <label>Quantity<input style={style} type="number" required min={1} max={100000} value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
        <label>Unit cost (LKR)<input style={style} inputMode="decimal" value={unitCost} onChange={e=>setUnitCost(e.target.value)}/></label>
        <label>Notes<input style={style} value={notes} maxLength={250} onChange={e=>setNotes(e.target.value)}/></label>
      </div><button style={{marginTop:12}} className="small-action" disabled={busy}>Create draft PO</button></form>
    </div>
    <div className="panel" style={{marginBottom:20}}><div className="panel-header"><h3>Purchase orders</h3></div>
      <div className="table-scroll"><table><thead><tr><th>Number</th><th>Supplier</th><th>Status</th><th>Lines</th><th>Action</th></tr></thead><tbody>
        {data.orders.map(o=><tr key={o.id}><td>{o.orderNumber}</td><td>{o.supplier.name}</td><td>{o.status}</td>
          <td>{o.lines.map(l=>l.product.name+" × "+l.quantityOrdered+" ("+formatMoney(l.unitCostCents)+")").join(", ")}</td>
          <td>{o.status==="DRAFT"&&<button disabled={busy} onClick={()=>void command({action:"place",orderId:o.id},"PO marked ORDERED.")}>Mark ordered</button>}
            {(o.status==="DRAFT"||o.status==="ORDERED")&&<button disabled={busy}
              onClick={()=>void command({action:"cancel",orderId:o.id},"PO cancelled.")}>Cancel</button>}</td></tr>)}
        </tbody></table></div></div>
    <p className="small-disclaimer">Purchase orders are administrative planning records, not supplier payments. No live supplier messaging, accounts payable, linked partial receiving, or delivery reconciliation yet.</p>
  </main>;
}
