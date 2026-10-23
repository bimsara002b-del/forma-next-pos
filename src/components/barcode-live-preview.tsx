"use client";
import { code128Bars,fitsLabel } from "@/lib/barcodes";
import { barcodeValue,type LabelPaper,type LabelOptions,type LabelProduct,type PrinterProfile } from "@/lib/barcode-label-sheet";

export function BarcodeLivePreview({
 product,paper,profile,options
}: {product?:LabelProduct;paper:LabelPaper;profile:PrinterProfile;options:LabelOptions}) {
 const code=product?barcodeValue(product):"";
 const width=paper==="A4"?48:paper==="40x30"?40:50;
 let drawing:ReturnType<typeof code128Bars>|null=null;
 try{if(code&&fitsLabel(code,width))drawing=code128Bars(code);}catch{}
 const name=options.showName&&product?<strong style={{display:"block",fontSize:profile.template==="compact"?10:12,lineHeight:1.1,maxHeight:24,overflow:"hidden"}}>{product.name}</strong>:null;
 const price=options.showPrice&&product?<strong style={{fontSize:12}}>Rs. {(product.priceCents/100).toFixed(2)}</strong>:null;
 return <div style={{padding:16,background:"#f1f5f9",borderRadius:10}}>
  <div style={{width:width*4.1,minHeight:125,margin:"auto",background:"#fff",color:"#000",padding:8,textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center"}}>
   <div style={{width:"100%",transform:"translate("+profile.offsetXmm*4.1+"px,"+profile.offsetYmm*4.1+"px)",overflow:"hidden"}}>
    {profile.storeName&&<div style={{fontSize:9,whiteSpace:"nowrap",overflow:"hidden"}}>{profile.storeName}</div>}
    {profile.template==="price-first"?<>{price}{name}</>:name}
    {drawing?<svg viewBox={"0 0 "+drawing.width+" 60"} preserveAspectRatio="none" role="img" aria-label={"Code 128: "+code}
      style={{width:"100%",height:profile.barcodeHeightMm*4.1,fill:"#000",display:"block"}}>
      {drawing.bars.map((b,i)=><rect key={i} x={b.x} y={0} width={b.width} height={60}/>)}
     </svg>:<div style={{fontSize:10,height:40}}>Choose a scannable product</div>}
    {product&&options.showCode&&<div style={{font:"10px monospace"}}>{code}</div>}
    {profile.template!=="price-first"&&price}
   </div>
  </div>
  <p className="small-disclaimer" style={{textAlign:"center",marginTop:8}}>Live preview (approximate). Print at 100% and verify on actual hardware.</p>
 </div>;
}
