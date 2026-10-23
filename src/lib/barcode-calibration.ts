import { barcodeSvg, type LabelPaper, type PrinterProfile, validatePrinterProfile } from "./barcode-label-sheet";
import { fitsLabel } from "./barcodes";
export const TEST_CODE = "123456789012";
export function renderCalibration(paper: LabelPaper, profile: PrinterProfile) {
 validatePrinterProfile(profile);
 const width = paper==="A4"?48:paper==="40x30"?40:paper==="50x30"?50:0;
 if(!width || !fitsLabel(TEST_CODE,width)) throw Error("Invalid paper / test barcode.");
 const a4=paper==="A4", count=a4?8:2;
 const barcode=barcodeSvg(TEST_CODE);
 const label='<div class="label"><strong>BARCODE CALIBRATION</strong><div class="bars">'+barcode+'</div><span>'+TEST_CODE+'</span><div class="ruler">10 mm</div></div>';
 const style='@page{size:'+(a4?'A4':width+'mm 30mm')+';margin:'+(a4?'5mm':'0')+'}'+
 '*{box-sizing:border-box}body{margin:0;font-family:Arial;color:#000;background:#fff}'+
 '.sheet{'+(a4?'display:grid;grid-template-columns:repeat(4,48mm);gap:2mm;':'')+'}'+
 '.label{width:'+width+'mm;height:30mm;padding:1mm;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;border:0.2mm dashed #777;'+(a4?'break-inside:avoid;':'break-after:page;')+'}'+
 '.label strong{font-size:6pt}.label span{font:7pt monospace}.bars{width:100%;height:'+Math.min(12,profile.barcodeHeightMm)+'mm;transform:translate('+profile.offsetXmm+'mm,'+profile.offsetYmm+'mm)}.bars svg{width:100%;height:100%;fill:black}'+
 '.ruler{width:10mm;height:3mm;text-align:center;font-size:5pt;border-bottom:0.2mm solid black;border-left:0.2mm solid black;border-right:0.2mm solid black}'+
 '.print-button{margin:12px;padding:8px}@media print{.print-button{display:none}}';
 return '<!doctype html><html><head><meta charset="utf-8"><title>Print calibration</title><style>'+style+'</style></head><body><button class="print-button" onclick="window.print()">Print / Reprint</button><div class="sheet">'+Array.from({length:count},()=>label).join('')+'</div></body></html>';
}
