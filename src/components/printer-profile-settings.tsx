"use client";
import { useEffect, useState } from "react";
import { DEFAULT_PRINTER_PROFILE, validatePrinterProfile, type PrinterProfile } from "@/lib/barcode-label-sheet";
import { PROFILE_STORAGE_KEY, readNamedProfiles, upsertNamedProfile,
  deleteNamedProfile, type NamedProfile } from "@/lib/printer-profile-store";

export function PrinterProfileSettings({
 profile,onChange
}: {profile:PrinterProfile;onChange:(value:PrinterProfile)=>void}) {
 const [saved,setSaved]=useState<NamedProfile[]>([]);
 const [chosen,setChosen]=useState("");
 const [name,setName]=useState("");
 const [notice,setNotice]=useState("");
 const [error,setError]=useState("");
 useEffect(()=>{
  let active=true;
  void Promise.resolve().then(()=>{
   try{const value=readNamedProfiles(window.localStorage.getItem(PROFILE_STORAGE_KEY));if(active)setSaved(value);}
   catch{if(active)setError("This browser blocks saved printer profiles.");}
  });
  return()=>{active=false;};
 },[]);
 const style={width:"100%",padding:"10px 12px",border:"1px solid #dce4ea",borderRadius:8};
 function set<K extends keyof PrinterProfile>(key:K,value:PrinterProfile[K]){
  onChange({...profile,[key]:value});setNotice("");setError("");
 }
 function persist(next:NamedProfile[]){
  try{window.localStorage.setItem(PROFILE_STORAGE_KEY,JSON.stringify(next));setSaved(next);return true;}
  catch{setError("Could not write browser storage.");return false;}
 }
 function save(){
  setNotice("");setError("");
  try{
   const next=upsertNamedProfile(saved,name.trim(),profile);
   if(persist(next)){setChosen(name.trim());setNotice("Printer profile saved locally in this browser.");}
  }catch(e){setError(e instanceof Error?e.message:"Could not save profile.");}
 }
 function choose(value:string){
  setChosen(value);setNotice("");setError("");
  const item=saved.find(x=>x.name===value);
  if(item){onChange({...item.settings});setName(item.name);setNotice("Saved printer settings loaded.");}
 }
 function remove(){
  if(!chosen||!window.confirm("Delete saved printer profile '"+chosen+"'?"))return;
  if(persist(deleteNamedProfile(saved,chosen))){setChosen("");setName("");setNotice("Saved profile deleted; current print settings unchanged.");}
 }
 let invalid="";
 try{validatePrinterProfile(profile);}catch(e){invalid=e instanceof Error?e.message:"Invalid printer settings.";}
 return <section className="panel" style={{padding:20,margin:"20px 0"}}>
  <h3>Custom label template & printer calibration</h3>
  <p className="small-disclaimer">Profiles save on this browser only, not to the POS database or another staff device. Print an actual test label before adjusting alignment.</p>
  <div className="form-grid">
   <label>Template<select style={style} value={profile.template} onChange={e=>set("template",e.target.value as PrinterProfile["template"])}>
    <option value="classic">Classic</option><option value="compact">Compact</option><option value="price-first">Price first</option>
   </select></label>
   <label>Shop name<input style={style} maxLength={36} value={profile.storeName} onChange={e=>set("storeName",e.target.value)}/></label>
   <label>Barcode height (7–16 mm)<input style={style} type="number" min={7} max={16} step={1} value={profile.barcodeHeightMm} onChange={e=>set("barcodeHeightMm",Number(e.target.value))}/></label>
   <label>Horizontal offset (−2 to +2 mm)<input style={style} type="number" min={-2} max={2} step={0.5} value={profile.offsetXmm} onChange={e=>set("offsetXmm",Number(e.target.value))}/></label>
   <label>Vertical offset (−2 to +2 mm)<input style={style} type="number" min={-2} max={2} step={0.5} value={profile.offsetYmm} onChange={e=>set("offsetYmm",Number(e.target.value))}/></label>
  </div>
  <div className="form-grid" style={{marginTop:16}}>
   <label>Saved profiles<select style={style} value={chosen} onChange={e=>choose(e.target.value)}>
    <option value="">Select saved profile</option>{saved.map(item=><option key={item.name} value={item.name}>{item.name}</option>)}
   </select></label>
   <label>Save current settings as<input style={style} value={name} maxLength={40} placeholder="e.g. Thermal Printer 50×30" onChange={e=>setName(e.target.value)}/></label>
  </div>
  <div className="stock-actions" style={{marginTop:16}}>
   <button type="button" disabled={!!invalid} onClick={save}>Save / update profile</button>
   <button type="button" disabled={!chosen} onClick={remove}>Delete saved profile</button>
   <button type="button" onClick={()=>{onChange({...DEFAULT_PRINTER_PROFILE});setChosen("");setNotice("Current settings reset; saved profiles kept.");setError("");}}>Reset current settings</button>
  </div>
  {(error||invalid)&&<p className="form-error" role="alert">{error||invalid}</p>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
