"use client";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { formatMoney } from "@/lib/money";
type Line={id:string;productName:string;quantity:number;returnedQty:number;unitPriceCents:number};
type Sale={id:string;receiptNumber:string;totalCents:number;paymentMethod:string;items:Line[];
 returns:{id:string;returnNumber:string;refundCents:number;reason:string;createdAt:string}[]};
type Payload={requestId:string;saleId:string;reason:string;lines:{saleItemId:string;quantity:number;restock:boolean}[]};
export function ReturnDashboard(){
 const [saleId,setSaleId]=useState("");
 const [sale,setSale]=useState<Sale|null>(null);
 const [reason,setReason]=useState("");
 const [qty,setQty]=useState<Record<string,string>>({});
 const [restock,setRestock]=useState<Record<string,boolean>>({});
 const [pending,setPending]=useState<Payload|null>(null);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [error,setError]=useState("");
 async function request<T>(url:string,init?:RequestInit){
  const r=await fetch(url,{cache:"no-store",...init});const data=await r.json();
  if(!r.ok)throw Error(data.error??"Operation failed.");return data as T;
 }
 async function lookup(id=saleId){
  const result=await request<{sale:Sale}>("/api/returns?saleId="+encodeURIComponent(id));
  setSale(result.sale);setQty({});setRestock({});
 }
 async function lookupEvent(e:FormEvent){e.preventDefault();setError("");setMessage("");setSale(null);
  try{await lookup();}catch(e){setError(e instanceof Error?e.message:"Receipt not found.");}
 }
 async function submit(payload:Payload){
  setPending(payload);setBusy(true);setError("");setMessage("");
  try{
   const r=await request<{returnNumber:string;refundCents:number;replay:boolean}>("/api/returns",
    {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
   setPending(null);setReason("");
   await lookup(payload.saleId);
   setMessage((r.replay?"Existing return confirmed: ":"Return recorded: ")+r.returnNumber+" · "+formatMoney(r.refundCents)+
    ". Cash must be paid to the customer manually; no gateway transfer occurred.");
  }catch(e){setError((e instanceof Error?e.message:"Refund unconfirmed.")+
    " Verify return history. If uncertain, retry the SAME request without editing it.");}
  finally{setBusy(false);}
 }
 function prepare(e:FormEvent){e.preventDefault();if(!sale||pending)return;
  const lines=sale.items.map(item=>({saleItemId:item.id,quantity:Number(qty[item.id]??"0"),restock:restock[item.id]??false}))
   .filter(item=>item.quantity>0);
  if(!lines.length||reason.trim().length<4||lines.some(item=>{
    const source=sale.items.find(x=>x.id===item.saleItemId)!;
    return !Number.isSafeInteger(item.quantity)||item.quantity>source.quantity-source.returnedQty;
  })){setError("Check available quantities and a reason of at least four characters.");return;}
  const amount=lines.reduce((sum,line)=>sum+line.quantity*(sale.items.find(x=>x.id===line.saleItemId)?.unitPriceCents??0),0);
  if(!window.confirm("Manager approval: record CASH refund "+formatMoney(amount)+
    "? Ensure the actual drawer has sufficient cash. This is not a gateway transfer."))return;
  void submit({requestId:crypto.randomUUID(),saleId:sale.id,reason:reason.trim(),lines});
 }
 return <main className="content-scroll" style={{maxWidth:1050,margin:"0 auto"}}>
  <div className="content-heading"><div><Link href="/" className="text-link">← Back to POS</Link>
    <h1 style={{marginTop:12}}>Returns & Cash Refunds</h1><p>Manager / Owner approval · Local demo only</p></div></div>
  <div className="panel" style={{padding:20,marginBottom:20}}>
    <h3>Find original sale</h3>
    <form onSubmit={e=>void lookupEvent(e)} style={{display:"flex",gap:12,alignItems:"end"}}>
      <label style={{flex:1}}>Sale ID <input required value={saleId} onChange={e=>setSaleId(e.target.value)}
        placeholder="Copy sale ID from sales data"/></label>
      <button className="small-action" disabled={busy}>Find sale</button>
    </form>
  </div>
  {error&&<p className="form-error" role="alert">{error}</p>}
  {message&&<p role="status" style={{color:"#148657"}}>{message}</p>}
  {sale&&<div className="panel" style={{padding:20,marginBottom:20}}>
    <h3>{sale.receiptNumber} · {formatMoney(sale.totalCents)}</h3>
    <p className="small-disclaimer">Cash refunds require an OPEN register shift. Only returned, resaleable items should be restocked.</p>
    {sale.paymentMethod!=="CASH"?<p>Only cash sales are supported.</p>:
    <form onSubmit={prepare}>
     <div className="table-scroll"><table><thead><tr><th>Product</th><th>Sold</th><th>Previously returned</th><th>Refund quantity</th><th>Restock</th></tr></thead>
      <tbody>{sale.items.map(line=><tr key={line.id}><td>{line.productName} ({formatMoney(line.unitPriceCents)})</td>
       <td>{line.quantity}</td><td>{line.returnedQty}</td>
       <td><input type="number" min={0} max={line.quantity-line.returnedQty} step={1}
          value={qty[line.id]??"0"} disabled={busy||!!pending}
          onChange={e=>setQty(old=>({...old,[line.id]:e.target.value}))}/></td>
       <td><input type="checkbox" checked={restock[line.id]??false} disabled={busy||!!pending}
          onChange={e=>setRestock(old=>({...old,[line.id]:e.target.checked}))}/></td>
      </tr>)}</tbody></table></div>
     <label>Return reason<input required minLength={4} maxLength={160} value={reason}
       disabled={busy||!!pending} onChange={e=>setReason(e.target.value)}/></label>
     <div className="stock-actions" style={{marginTop:14}}>
      <button type="submit" disabled={busy||!!pending} className="small-action">Record cash refund</button>
      {pending&&<button type="button" disabled={busy} onClick={()=>void submit(pending)}>Retry SAME refund</button>}
     </div>
    </form>}
    <h3 style={{marginTop:24}}>Recorded returns</h3>
    <div className="table-scroll"><table><thead><tr><th>Return</th><th>Refund</th><th>Reason</th><th>Date</th></tr></thead>
    <tbody>{sale.returns.map(r=><tr key={r.id}><td>{r.returnNumber}</td><td>{formatMoney(r.refundCents)}</td>
      <td>{r.reason}</td><td>{new Date(r.createdAt).toLocaleString("en-LK")}</td></tr>)}</tbody></table></div>
  </div>}
  <p className="small-disclaimer">Exchanges require a separately recorded return and new checkout. No original sale is deleted, and this prototype does not transfer money automatically.</p>
 </main>;
}