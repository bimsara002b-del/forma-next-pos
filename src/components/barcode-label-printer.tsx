"use client";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { code128Bars,fitsLabel } from "@/lib/barcodes";
type Product={id:string;name:string;sku:string;barcode:string|null;priceCents:number};
type Size="40x30"|"50x30"|"A4";
function escapeHtml(x:string){return x.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");}
function svg(value:string){
 const {width,bars}=code128Bars(value);
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+width+' 60" preserveAspectRatio="none">'+bars.map(b=>'<rect x="'+b.x+'" width="'+b.width+'" y="0" height="60"/>').join("")+'</svg>';
}
export function BarcodeLabelPrinter(){
 const [products,setProducts]=useState<Product[]>([]);
 const [selected,setSelected]=useState("");
 const [query,setQuery]=useState("");
 const [size,setSize]=useState<Size>("50x30");
 const [copies,setCopies]=useState(1);
 const [name,setName]=useState(true);
 const [price,setPrice]=useState(true);
 const [codeText,setCodeText]=useState(true);
 const [error,setError]=useState("");
 useEffect(()=>{let active=true;
  void fetch("/api/products",{cache:"no-store"}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||"Catalog unavailable");return d.products as Product[];})
   .then(rows=>{if(active){setProducts(rows);setSelected(rows[0]?.id??"");}})
   .catch(e=>{if(active)setError(String(e));});return()=>{active=false;};
 },[]);
 const product=products.find(p=>p.id===selected);
 const code=product?.barcode?.trim()||product?.sku.trim()||"";
 let bars="",valid=false;
 try{if(code){bars=svg(code);valid=fitsLabel(code,size==="A4"?48:size==="40x30"?40:50);}}catch{}
 function print(e:FormEvent){
  e.preventDefault();setError("");
  if(!product||!valid||!Number.isInteger(copies)||copies<1||copies>100){setError("Choose a valid product, label size and 1–100 copies.");return;}
  const a4=size==="A4",width=a4?48:size==="40x30"?40:50;
  const label='<div class="label">'+(name?'<strong>'+escapeHtml(product.name)+'</strong>':"")+
   '<div class="bars">'+bars+'</div>'+(codeText?'<span>'+escapeHtml(code)+'</span>':"")+
   (price?'<b>Rs. '+(product.priceCents/100).toFixed(2)+'</b>':"")+'</div>';
  const documentHtml='<!doctype html><html><head><title>Barcode labels</title><style>'+
   '@page{size:'+(a4?'A4':width+'mm 30mm')+';margin:'+(a4?'5mm':'0')+'}'+
   '*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#000;background:#fff}'+
   '.sheet{'+(a4?'display:grid;grid-template-columns:repeat(4,48mm);column-gap:2mm;row-gap:2mm;align-content:start;':'')+'}'+
   '.label{width:'+width+'mm;height:30mm;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:1.5mm;overflow:hidden;text-align:center;'+(a4?'break-inside:avoid;page-break-inside:avoid;':'break-after:page;')+'}'+
   '.label strong{font-size:9pt;line-height:1.1;max-height:9mm;overflow:hidden}'+
   '.bars{width:100%;height:12mm}.bars svg{width:100%;height:100%;fill:#000}'+
   '.label span{font:8pt monospace;white-space:nowrap}.label b{font-size:10pt}</style></head><body><div class="sheet">'+
   Array.from({length:copies},()=>label).join("")+'</div></body></html>';
  const win=window.open("","_blank","width=850,height=700");
  if(!win){setError("Allow pop-ups to print labels.");return;}
  win.document.open();win.document.write(documentHtml);win.document.close();
  win.addEventListener("load",()=>{win.focus();win.print();},{once:true});
 }
 const filtered=products.filter(p=>[p.name,p.sku,p.barcode??""].some(s=>s.toLowerCase().includes(query.toLowerCase())));
 return <main className="content-scroll" style={{maxWidth:1000,margin:"auto"}}>
  <div className="content-heading"><div><Link className="text-link" href="/">← Back to POS</Link><h1>Barcode Label Printing</h1><p>Code 128 · Thermal labels & A4 paper</p></div></div>
  {error&&<p role="alert" className="form-error">{error}</p>}
  <div className="panel" style={{padding:24}}><form onSubmit={print}>
   <div className="form-grid">
    <label>Search products<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name, SKU or barcode"/></label>
    <label>Product<select required value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose product</option>{filtered.map(p=><option key={p.id} value={p.id}>{p.name} — {p.barcode||p.sku}</option>)}</select></label>
    <label>Label size<select value={size} onChange={e=>setSize(e.target.value as Size)}><option value="50x30">50 × 30 mm thermal</option><option value="40x30">40 × 30 mm thermal</option><option value="A4">A4 sheet · 48 × 30 mm labels</option></select></label>
    <label>Copies<input type="number" min="1" max="100" required value={copies} onChange={e=>setCopies(Number(e.target.value))}/></label>
   </div>
   <div style={{display:"flex",gap:15,margin:"16px 0",flexWrap:"wrap"}}>
    <label><input type="checkbox" checked={name} onChange={e=>setName(e.target.checked)}/> Name</label>
    <label><input type="checkbox" checked={price} onChange={e=>setPrice(e.target.checked)}/> Price</label>
    <label><input type="checkbox" checked={codeText} onChange={e=>setCodeText(e.target.checked)}/> Barcode text</label>
   </div>
   <h3>Preview</h3><div style={{padding:16,background:"#f1f5f9",borderRadius:10}}>
    <div style={{background:"#fff",color:"#000",padding:12,width:210,margin:"auto",textAlign:"center"}}>
     {name&&<strong style={{display:"block",fontSize:12}}>{product?.name}</strong>}
     {bars&&<div style={{height:55}} dangerouslySetInnerHTML={{__html:bars}}/>}
     {codeText&&<div style={{font:"11px monospace"}}>{code}</div>}
     {price&&<strong>{product?"Rs. "+(product.priceCents/100).toFixed(2):"—"}</strong>}
    </div>
   </div>
   {product&&!valid&&<p className="form-error">Barcode must be printable ASCII, up to 40 characters, and fit chosen label width.</p>}
   <button className="small-action" style={{marginTop:18}} disabled={!valid||!product}>Print barcode labels</button>
  </form></div>
  <p className="small-disclaimer" style={{marginTop:16}}>Set paper size and 100% print scaling in your browser printer settings. Test real label printer and scanner readability. No stock is modified by printing.</p>
 </main>;
}
