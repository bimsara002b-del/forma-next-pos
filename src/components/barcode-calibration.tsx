"use client";
import { useState } from "react";
import { renderCalibration, TEST_CODE } from "@/lib/barcode-calibration";
import { type LabelPaper, type PrinterProfile } from "@/lib/barcode-label-sheet";
export function BarcodeCalibration({profile}:{profile:PrinterProfile}){
 const [paper,setPaper]=useState<LabelPaper>("50x30");
 const [error,setError]=useState("");
 function print(){
  setError("");
  let html="";
  try{html=renderCalibration(paper,profile);}catch(e){setError(e instanceof Error?e.message:"Unable to print");return;}
  const popup=window.open("","_blank","width=900,height=800");
  if(!popup){setError("Enable popups to print calibration labels.");return;}
  popup.addEventListener("load",()=>{popup.focus();popup.print();},{once:true});
  popup.document.open();popup.document.write(html);popup.document.close();
 }
 return <section className="panel" style={{padding:20,marginTop:20}}>
  <h3>Printer calibration test labels</h3>
  <p className="small-disclaimer">Print a real Code 128 test barcode ({TEST_CODE}), label boundary and 10 mm ruler. Use 100% print scale and check with a physical ruler and barcode scanner.</p>
  <label>Paper <select value={paper} onChange={e=>setPaper(e.target.value as LabelPaper)}>
   <option value="40x30">Thermal 40 × 30 mm (2 labels)</option>
   <option value="50x30">Thermal 50 × 30 mm (2 labels)</option>
   <option value="A4">A4 48 × 30 mm (8 labels)</option>
  </select></label>
  {error&&<p className="form-error" role="alert">{error}</p>}
  <p className="small-disclaimer">Current offsets: X {profile.offsetXmm} mm, Y {profile.offsetYmm} mm.</p>
  <button className="small-action" type="button" onClick={print}>Print calibration labels</button>
  <p className="small-disclaimer">Printer driver alignment and scan reliability cannot be verified by software checks alone.</p>
 </section>;
}