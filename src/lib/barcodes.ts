const patterns = ["212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112"] as const;
export function code128Symbols(value:string):number[]{
 if(!value||value.length>40||!/^[\x20-\x7e]+$/.test(value))throw Error("Barcode must be 1–40 printable ASCII characters");
 const numeric=/^\d+$/.test(value)&&value.length%2===0;
 const start=numeric?105:104;
 const data=numeric?(value.match(/\d{2}/g)??[]).map(Number):[...value].map(x=>x.charCodeAt(0)-32);
 return [start,...data,(start+data.reduce((sum,n,i)=>sum+n*(i+1),0))%103,106];
}
export function code128Bars(value:string){
 let x=10;const bars:{x:number;width:number}[]=[];
 for(const symbol of code128Symbols(value)){
  const pattern=patterns[symbol];
  for(let i=0;i<pattern.length;i++){const width=Number(pattern[i]);if(i%2===0)bars.push({x,width});x+=width;}
 }
 return {width:x+10,bars};
}
export function fitsLabel(value:string,widthMm:number){return (widthMm-4)/code128Bars(value).width>=0.20;}
