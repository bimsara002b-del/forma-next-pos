"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/money";
import { sriLankaDate, dateDaysBefore } from "@/lib/report-calendar";
type Report={
 period:{from:string;to:string;timezone:string};
 sales:{count:number;revenueCents:number;unitsSold:number};
 margin:{knownCostLineCount:number;unknownCostLineCount:number;coveredRevenueCents:number;knownCostCents:number;grossProfitOnCoveredSalesCents:number;method:string};
 inventory:{lowStockProducts:number;knownCostStockUnits:number;knownCostValuationCents:number;unknownCostProducts:number;activeProductCount:number;valuationMethod:string};
 closedShifts:{count:number;netCashVarianceCents:number};
 shiftReconciliation:{limited:boolean;recent:{id:string;closedAt:string|null;openingFloatCents:number;cashSalesCents:number;cashInCents:number;cashOutCents:number;refundCents:number;otherCents:number;ledgerExpectedCents:number;recordedExpectedCents:number|null;countedCashCents:number|null;ledgerVarianceCents:number|null;matchesClosingSnapshot:boolean}[]};
 topProducts:{productId:string;name:string;quantity:number;revenueCents:number}[];
 refunds:{count:number;amountCents:number;netCashRevenueCents:number;note:string};
 refundMargin:{knownCostLines:number;unknownCostLines:number;knownRefundCents:number;unknownRefundCents:number;
  restockedCostRecoveryCents:number;knownRefundMarginImpactCents:number;totalLineRefundCents:number;
  knownCostSalesMarginCents:number;adjustedKnownCostMarginCents:number;note:string};
 daily:{date:string;salesCount:number;revenueCents:number}[]|null;dailyChartComplete:boolean;
};
const dateToday=()=>sriLankaDate(new Date());
const dateStart=()=>dateDaysBefore(dateToday(),29);
export function ReportsDashboard(){
 const [from,setFrom]=useState(dateStart);
 const [to,setTo]=useState(dateToday);
 const [result,setResult]=useState<Report|null>(null);
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 async function load(a:string,b:string){
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/reports?"+new URLSearchParams({from:a,to:b}),{cache:"no-store"});
   const data=await response.json();
   if(!response.ok)throw Error(data.error??"Could not generate reports.");
   setResult(data as Report);
  }catch(e){setError(e instanceof Error?e.message:"Report unavailable.");}
  finally{setBusy(false);}
 }
 useEffect(()=>{
  let active=true;
  void fetch("/api/reports?"+new URLSearchParams({from:dateStart(),to:dateToday()}),{cache:"no-store"})
   .then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error??"Report unavailable");return data as Report;})
   .then(data=>{if(active)setResult(data);}).catch(e=>{if(active)setError(e instanceof Error?e.message:"Report unavailable");});
  return()=>{active=false;};
 },[]);
 const peak=Math.max(1,...(result?.daily??[]).map(x=>x.revenueCents));
 return <main className="content-scroll" style={{maxWidth:1160,margin:"0 auto"}}>
  <div className="content-heading"><div><Link href="/" className="text-link">← Back to POS</Link><h1 style={{marginTop:12}}>Reports & Analytics</h1><p>Manager/Owner · Sri Lanka business dates (Asia/Colombo) · Read only</p></div></div>
  <form className="panel" style={{padding:20,display:"flex",gap:15,flexWrap:"wrap",alignItems:"end",marginBottom:18}} onSubmit={e=>{e.preventDefault();void load(from,to);}}>
   <label>From (Sri Lanka)<input type="date" required value={from} onChange={e=>setFrom(e.target.value)}/></label>
   <label>To (Sri Lanka)<input type="date" required value={to} onChange={e=>setTo(e.target.value)}/></label>
   <button className="small-action" disabled={busy}>{busy?"Loading…":"Generate report"}</button>
  </form>
  {error&&<p className="form-error" role="alert">{error}</p>}
  {result&&<>
   <div className="stat-grid" style={{marginBottom:18}}>
    {[
      ["Gross sales",formatMoney(result.sales.revenueCents)],
      ["Cash refunds",formatMoney(result.refunds.amountCents)],
      ["Net sales less refunds",formatMoney(result.refunds.netCashRevenueCents)],
      ["Units Sold",String(result.sales.unitsSold)],
      ["Gross profit (covered sales only)",formatMoney(result.margin.grossProfitOnCoveredSalesCents)],
      ["Known-cost inventory value",formatMoney(result.inventory.knownCostValuationCents)]
    ].map(([title,value])=><div className="stat-card" key={title}><div className="stat-label">{title}</div><div className="stat-value">{value}</div></div>)}
   </div>
   <div className="panel" style={{padding:20,marginBottom:18}}><h3>Daily sales · {result.period.timezone}</h3>
    {result.daily?<div style={{display:"flex",gap:4,height:150,alignItems:"end",overflowX:"auto"}}>
      {result.daily.map(x=><div key={x.date} title={x.date+" "+formatMoney(x.revenueCents)} style={{height:Math.max(3,x.revenueCents/peak*135),minWidth:7,flex:"1 0 7px",background:"#17855a",borderRadius:3}}/>)}
    </div>:<p>Daily chart hidden because over 10,000 sales were found; aggregate totals remain complete.</p>}
    <p className="small-disclaimer">Each day is calculated from midnight to midnight in Sri Lanka (UTC+05:30).</p>
   </div>
   <div className="panel" style={{marginBottom:18}}><div className="panel-header"><h3>Top selling products</h3></div>
    <div className="table-scroll"><table><thead><tr><th>Product</th><th>Units</th><th>Sales revenue</th></tr></thead>
     <tbody>{result.topProducts.map(x=><tr key={x.productId}><td>{x.name}</td><td>{x.quantity}</td><td>{formatMoney(x.revenueCents)}</td></tr>)}</tbody>
    </table></div>
   </div>
   <div className="panel" style={{padding:20,marginBottom:18}}><h3>Closed cash shift reconciliation</h3>
    <p className="small-disclaimer">Latest 20 closed shifts in the selected period. Refunds are already negative cash movements; never subtract twice. Read-only audit, not accounting certification.</p>
    <div className="table-scroll"><table><thead><tr><th>Closed (UTC)</th><th>Cash sales</th><th>Refund movement</th><th>Expected (ledger)</th><th>Counted</th><th>Variance</th><th>Check</th></tr></thead>
     <tbody>{result.shiftReconciliation.recent.map(row=><tr key={row.id}>
      <td>{row.closedAt??"—"}</td><td>{formatMoney(row.cashSalesCents)}</td>
      <td>{formatMoney(row.refundCents)}</td><td>{formatMoney(row.ledgerExpectedCents)}</td>
      <td>{row.countedCashCents===null?"—":formatMoney(row.countedCashCents)}</td>
      <td>{row.ledgerVarianceCents===null?"—":formatMoney(row.ledgerVarianceCents)}</td>
      <td>{row.matchesClosingSnapshot?"Matched":"Review"}</td>
     </tr>)}</tbody></table></div>
    {result.shiftReconciliation.limited&&<p className="small-disclaimer">Showing latest 20 shifts; period-level totals remain complete.</p>}
   </div>
   <div className="panel" style={{padding:20}}><h3>Profit coverage and inventory</h3>
    <p>Sales: {result.sales.count} · Known-cost lines: {result.margin.knownCostLineCount} · Missing-cost lines: {result.margin.unknownCostLineCount}</p>
    <p>Revenue on known-cost lines: {formatMoney(result.margin.coveredRevenueCents)} · Recorded costs: {formatMoney(result.margin.knownCostCents)}</p>
    <p>Refund impact on known-cost margin: {formatMoney(result.refundMargin.knownRefundMarginImpactCents)} · Restocked historical cost recovery: {formatMoney(result.refundMargin.restockedCostRecoveryCents)}</p>
    <p>Known-cost sales margin after known-cost refunds: {formatMoney(result.refundMargin.adjustedKnownCostMarginCents)}</p>
    <p>Known-cost refund lines: {result.refundMargin.knownCostLines} · Unknown-cost refund lines: {result.refundMargin.unknownCostLines} · Refunds with unknown cost: {formatMoney(result.refundMargin.unknownRefundCents)}</p>
    <p className="small-disclaimer">{result.refundMargin.note}</p>
    <p>Low-stock products: {result.inventory.lowStockProducts} · Products with unknown cost: {result.inventory.unknownCostProducts}</p>
    <p>Closed shifts: {result.closedShifts.count} · Net counted variance: {formatMoney(result.closedShifts.netCashVarianceCents)}</p>
    <p>Cash refunds recorded: {result.refunds.count} · Refunded amount: {formatMoney(result.refunds.amountCents)}</p>
    <p className="small-disclaimer">{result.refunds.note} Net sales less refunds is not cash drawer balance or net profit.</p>
    <p className="small-disclaimer">{result.margin.method} Not net profit. Inventory valuation is based on current known costs, not FIFO.</p>
   </div>
  </>}
 </main>;
}