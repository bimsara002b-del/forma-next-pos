"use client";
import {FormEvent,useRef,useState} from "react";
import {TEST_CODE} from "@/lib/barcode-calibration";
import {diagnoseScan,type ScanProduct} from "@/lib/scanner-diagnostics";
export function ScannerDiagnostics({products}:{products:ScanProduct[]}){
 const [mode,setMode]=useState<"test"|"product">("test");
 const [id,setId]=useState("");const [raw,setRaw]=useState("");const [result,setResult]=useState<ReturnType<typeof diagnoseScan>|null>(null);
 const ref=useRef<HTMLInputElement>(null);const product=products.find(p=>p.id===id)||null;
 const expected=mode==="test"?TEST_CODE:(product?.barcode?.trim()||product?.sku||"");
 function submit(e:FormEvent){e.preventDefault();setResult(diagnoseScan(raw,mode,product,products));setRaw("");ref.current?.focus();}
 return <section className="panel" style={{padding:20,marginTop:18}}><h3>Barcode Scanner Diagnostics</h3>
  <p className="small-disclaimer">Focus the input and scan a printed reference or product barcode. Keyboard-wedge scanners can append Enter; manual Check Scan also works.</p>
  <div className="form-grid">
   <label>Test mode<select value={mode} onChange={e=>{setMode(e.target.value as "test"|"product");setResult(null);}}>
     <option value="test">Calibration reference</option><option value="product">Catalog product</option></select></label>
   {mode==="product"&&<label>Expected product<select value={id} onChange={e=>{setId(e.target.value);setResult(null);}}>
     <option value="">Choose product</option>{products.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>}
  </div>
  <p>Expected: <strong>{expected||"Choose a product"}</strong></p>
  <form onSubmit={submit}><label>Scanner input<input ref={ref} autoComplete="off" spellCheck={false} maxLength={80} value={raw} onChange={e=>setRaw(e.target.value)} placeholder="Click here and scan"/></label>
   <button type="submit" className="small-action" disabled={mode==="product"&&!product}>Check Scan</button></form>
  {result&&<div role="status" style={{marginTop:14}}>
   <strong>{result.status==="match"?"Matching barcode":result.status==="ambiguous"?"Duplicate codes found":result.status==="different"?"Different code received":result.status==="unknown"?"Product not found":result.status==="invalid"?"Invalid barcode text":"Nothing scanned"}</strong>
   <p>Received: <code>{result.text||"(empty)"}</code></p>
   {result.names.length>0&&<p>Catalog matches: {result.names.join(", ")}</p>}
  </div>}
  <p className="small-disclaimer">This verifies text received by the browser. Manually typed text can match too; physical scanner quality must be tested separately. No sales or inventory changes.</p>
 </section>;
}