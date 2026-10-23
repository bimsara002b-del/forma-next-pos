"use client";
import { FormEvent, useState } from "react";
type Product = {id:string;name:string;sku:string;barcode:string|null;category:string;stockQty:number;minStockQty:number;priceCents:number;costCents:number;isActive:boolean};
type Adjustment = {requestId:string;productId:string;expectedQty:number;delta:number;reason:"FOUND"|"LOSS"|"DAMAGE"|"CORRECTION";note:string};
export function StockAdjustmentPanel({products,onUpdated}:{products:Product[];onUpdated:()=>Promise<void>}){
 const [search,setSearch]=useState("");
 const [filter,setFilter]=useState("all");
 const [selected,setSelected]=useState("");
 const [direction,setDirection]=useState("out");
 const [quantity,setQuantity]=useState("1");
 const [reason,setReason]=useState<Adjustment["reason"]>("DAMAGE");
 const [note,setNote]=useState("");
 const [pending,setPending]=useState<Adjustment|null>(null);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState("");
 const [error,setError]=useState("");
 const active=products.filter(p=>p.isActive);
 const product=active.find(p=>p.id===selected);
 const matches=products.filter(p=>{
  const term=search.trim().toLowerCase();
  if(term && ![p.name,p.sku,p.barcode??"",p.category].some(s=>s.toLowerCase().includes(term)))return false;
  if(filter==="low")return p.isActive && p.stockQty<=p.minStockQty;
  if(filter==="out")return p.isActive && p.stockQty===0;
  if(filter==="archived")return !p.isActive;
  return true;
 });
 const style={width:"100%",padding:"10px 12px",border:"1px solid #dce4ea",borderRadius:8};
 function exportCsv(){
  const cell=(s:string|number)=>'"'+String(s).replaceAll('"','""')+'"';
  const rows=[["Name","SKU","Barcode","Category","Stock","Min Stock","Price LKR","Cost LKR","Status"],
   ...matches.map(p=>[p.name,p.sku,p.barcode??"",p.category,p.stockQty,p.minStockQty,
    (p.priceCents/100).toFixed(2),(p.costCents/100).toFixed(2),p.isActive?"Active":"Archived"])];
  const uri=URL.createObjectURL(new Blob(["\uFEFF"+rows.map(row=>row.map(cell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}));
  const link=document.createElement("a");link.href=uri;link.download="forma-inventory.csv";link.click();
  URL.revokeObjectURL(uri);
 }
 async function send(payload:Adjustment){
  setPending(payload);setBusy(true);setError("");setNotice("");
  try{
   const response=await fetch("/api/stock",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
   const data=await response.json();
   if(!response.ok){
    if(response.status<500)setPending(null);
    throw Error(data.error??"Stock adjustment could not be confirmed.");
   }
   setPending(null);setSelected("");setNote("");
   await onUpdated();
   setNotice(data.replay?"Previous stock adjustment confirmed; no double update.":"Audited stock adjustment saved.");
  }catch(e){
   setError((e instanceof Error?e.message:"Adjustment status uncertain.")+" Check stock ledger and retry only the SAME adjustment if needed.");
  }finally{setBusy(false);}
 }
 function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy||pending||!product)return;
  const count=Number(quantity),delta=direction==="in"?count:-count;
  if(!/^[1-9]\d{0,5}$/.test(quantity)||count>100000||product.stockQty+delta<0||
   product.stockQty+delta>1000000||note.trim().length<4||
   (reason==="FOUND"&&delta<0)||(reason==="DAMAGE"&&delta>0)||(reason==="LOSS"&&delta>0)){
   setError("Invalid quantity, direction, reason or note.");return;
  }
  if(!window.confirm("Record "+delta+" units for "+product.name+"?"))return;
  void send({requestId:crypto.randomUUID(),productId:product.id,expectedQty:product.stockQty,
   delta,reason,note:note.trim()});
 }
 return <>
  <div className="panel" style={{padding:20,marginBottom:20}}>
   <div className="panel-header"><h3>Inventory search & low-stock status</h3><span className="subtle-pill">{matches.length} products</span></div>
   <div className="form-grid" style={{marginTop:15}}>
    <label>Search name, barcode, SKU or category<input style={style} value={search} onChange={e=>setSearch(e.target.value)}/></label>
    <label>Filter<select style={style} value={filter} onChange={e=>setFilter(e.target.value)}>
     <option value="all">All</option><option value="low">Low stock</option><option value="out">Out of stock</option><option value="archived">Archived</option>
    </select></label>
   </div>
   <button type="button" style={{marginTop:14}} disabled={busy} onClick={exportCsv}>Export filtered CSV</button>
   <div className="table-scroll" style={{marginTop:14}}><table><thead><tr><th>Product</th><th>SKU</th><th>Barcode</th><th>Category</th><th>In stock</th><th>Low stock threshold</th><th>Status</th></tr></thead>
    <tbody>{matches.slice(0,500).map(p=><tr key={p.id}><td>{p.name}</td><td>{p.sku}</td><td>{p.barcode??"—"}</td>
     <td>{p.category}</td><td>{p.stockQty}</td><td>{p.minStockQty}</td>
     <td>{!p.isActive?"Archived":p.stockQty===0?"Out":p.stockQty<=p.minStockQty?"Low":"OK"}</td></tr>)}</tbody>
   </table></div>
   {matches.length>500&&<p className="small-disclaimer">Showing 500 rows; export includes all loaded matches.</p>}
  </div>
  <div className="panel" style={{padding:20,marginBottom:20}}>
   <h3>Audited stock adjustments</h3>
   <p className="small-disclaimer">Use purchase receiving for supplier deliveries. Adjust stock only for loss, damage, found items or corrections.</p>
   {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
   <form onSubmit={submit}><div className="form-grid">
    <label>Product<select required style={style} disabled={busy||!!pending} value={selected} onChange={e=>setSelected(e.target.value)}>
     <option value="">Choose product</option>{active.map(p=><option key={p.id} value={p.id}>{p.name} ({p.sku}) · {p.stockQty} units</option>)}
    </select></label>
    <label>Movement<select style={style} disabled={busy||!!pending} value={direction} onChange={e=>{
      setDirection(e.target.value);setReason(e.target.value==="in"?"FOUND":"DAMAGE");}}>
     <option value="in">Stock In</option><option value="out">Stock Out</option>
    </select></label>
    <label>Quantity<input type="number" style={style} min={1} max={100000} required disabled={busy||!!pending}
     value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
    <label>Reason<select style={style} disabled={busy||!!pending} value={reason} onChange={e=>setReason(e.target.value as Adjustment["reason"])}>
     {direction==="in"?<><option value="FOUND">Found stock</option><option value="CORRECTION">Correction</option></>:
      <><option value="DAMAGE">Damaged goods</option><option value="LOSS">Missing/loss</option><option value="CORRECTION">Correction</option></>}
    </select></label>
    <label>Audit note<input style={style} required minLength={4} maxLength={160} disabled={busy||!!pending}
      value={note} onChange={e=>setNote(e.target.value)} placeholder="Explain why stock changed"/></label>
    <label>Current stock<input style={style} readOnly value={product?.stockQty??""}/></label>
   </div><div className="stock-actions" style={{marginTop:16}}>
    <button className="small-action" disabled={busy||!!pending||!product}>Record adjustment</button>
    {pending&&<button type="button" disabled={busy} onClick={()=>void send(pending)}>Retry SAME adjustment</button>}
   </div></form>
   {pending&&<p className="small-disclaimer">Outcome unconfirmed; input is locked until the same request is resolved.</p>}
  </div>
 </>;
}
