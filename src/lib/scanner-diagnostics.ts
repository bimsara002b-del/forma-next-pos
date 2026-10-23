import { TEST_CODE } from "./barcode-calibration";
export type ScanProduct = {id:string;name:string;sku:string;barcode:string|null};
export function diagnoseScan(raw:string, mode:"test"|"product", selected:ScanProduct|null, products:ScanProduct[]){
 const text=raw.replace(/\r\n$|\r$|\n$/,"");
 const expected=mode==="test"?TEST_CODE:(selected?.barcode?.trim()||selected?.sku.trim()||"");
 if(!text)return {status:"empty",text,expected,names:[] as string[]};
 if(text.length>40||!/^[\x20-\x7e]+$/.test(text))return {status:"invalid",text,expected,names:[] as string[]};
 const matches=products.filter(p=>p.barcode?.trim()===text||p.sku.trim()===text);
 const names=matches.slice(0,5).map(x=>x.name);
 if(mode==="test")return {status:text===TEST_CODE?"match":"different",text,expected,names};
 if(matches.length>1)return {status:"ambiguous",text,expected,names};
 if(selected&&matches.length===1&&matches[0].id===selected.id&&text===expected)return {status:"match",text,expected,names};
 return {status:matches.length?"different":"unknown",text,expected,names};
}
