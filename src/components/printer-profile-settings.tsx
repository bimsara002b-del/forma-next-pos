"use client";
import { useState } from "react";
import { DEFAULT_PRINTER_PROFILE, validatePrinterProfile, type PrinterProfile } from "@/lib/barcode-label-sheet";
export function PrinterProfileSettings({ profile, onChange }: { profile: PrinterProfile; onChange:(value:PrinterProfile)=>void }) {
 const [message,setMessage]=useState("");
 const style={width:"100%",padding:"10px 12px",border:"1px solid #dce4ea",borderRadius:8};
 function set<K extends keyof PrinterProfile>(key:K,value:PrinterProfile[K]){
  onChange({...profile,[key]:value});setMessage("");
 }
 function reset(){onChange({...DEFAULT_PRINTER_PROFILE});setMessage("Printer settings reset to defaults.");}
 return <section className="panel" style={{padding:20,margin:"20px 0"}}>
  <h3>Custom label template & printer calibration</h3>
  <p className="small-disclaimer">Settings apply to both single-product and bulk labels. Adjust offsets only after printing a test sheet.</p>
  <div className="form-grid">
   <label>Template<select style={style} value={profile.template} onChange={e=>set("template",e.target.value as PrinterProfile["template"])}>
    <option value="classic">Classic</option><option value="compact">Compact</option><option value="price-first">Price first</option>
   </select></label>
   <label>Store name (optional)<input style={style} maxLength={36} value={profile.storeName} onChange={e=>set("storeName",e.target.value)}/></label>
   <label>Barcode height (7–16 mm)<input style={style} type="number" min={7} max={16} step={1} value={profile.barcodeHeightMm} onChange={e=>set("barcodeHeightMm",Number(e.target.value))}/></label>
   <label>Horizontal offset (−2 to +2 mm)<input style={style} type="number" min={-2} max={2} step={0.5} value={profile.offsetXmm} onChange={e=>set("offsetXmm",Number(e.target.value))}/></label>
   <label>Vertical offset (−2 to +2 mm)<input style={style} type="number" min={-2} max={2} step={0.5} value={profile.offsetYmm} onChange={e=>set("offsetYmm",Number(e.target.value))}/></label>
  </div>
  <div style={{marginTop:12}}><button type="button" onClick={reset}>Reset printer settings</button></div>
  {message&&<p role="status">{message}</p>}
  {(()=>{try{validatePrinterProfile(profile);return null;}catch(e){return <p role="alert" className="form-error">{e instanceof Error?e.message:"Invalid settings"}</p>;}})()}
 </section>;
}
