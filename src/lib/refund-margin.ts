/** Read-only historical refund impact on margin.
 * Return dates determine inclusion; original sale dates may be outside the period.
 * Restock reverses COGS only with a recorded original sale cost snapshot.
 * Damaged/non-restocked returns never reverse the original COGS.
 */
export type RefundCostLine={
 quantity:number;refundCents:number;restocked:boolean;unitCostCents:number|null;
};
export function summarizeRefundMargin(lines:RefundCostLine[]){
 let knownRefundCents=0,unknownRefundCents=0,restockedCostRecoveryCents=0;
 let knownCostLines=0,unknownCostLines=0;
 for(const line of lines){
  if(!Number.isSafeInteger(line.quantity)||line.quantity<=0||
     !Number.isSafeInteger(line.refundCents)||line.refundCents<0||
     (line.unitCostCents!==null&&(!Number.isSafeInteger(line.unitCostCents)||line.unitCostCents<0)))
    throw Error("INVALID_REFUND_HISTORY");
  if(line.unitCostCents===null){
   unknownCostLines++;
   unknownRefundCents+=line.refundCents;
  }else{
   knownCostLines++;
   knownRefundCents+=line.refundCents;
   if(line.restocked)restockedCostRecoveryCents+=line.unitCostCents*line.quantity;
  }
  if(![knownRefundCents,unknownRefundCents,restockedCostRecoveryCents].every(Number.isSafeInteger))
   throw Error("INVALID_REFUND_HISTORY");
 }
 return {
  knownCostLines,unknownCostLines,knownRefundCents,unknownRefundCents,
  restockedCostRecoveryCents,
  knownRefundMarginImpactCents:-knownRefundCents+restockedCostRecoveryCents,
  totalLineRefundCents:knownRefundCents+unknownRefundCents
 };
}
