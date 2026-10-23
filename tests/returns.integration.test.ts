import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { postCashReturn, calculateRefund } from "../src/lib/returns";
import { commitCashCheckout } from "../src/lib/checkout";
import { openCashShift } from "../src/lib/shifts";
const url=process.env.POS_RETURN_TEST_DATABASE_URL;
const db=url==="file:./returns-integration.test.db"?
 new PrismaClient({datasources:{db:{url}}}):null;
const test=db?it:it.skip;
const actor={id:"owner",role:"OWNER" as const,displayName:"Store Owner"};
async function saleFixture(){
 const p=await db!.product.create({data:{name:"Return test",sku:randomUUID(),priceCents:500,costCents:300,stockQty:20}});
 const sale=await commitCashCheckout(db!,{requestId:randomUUID(),receivedCents:2000,items:[{productId:p.id,quantity:3}]});
 return {p,sale:sale.sale};
}
describe("cash returns in isolated disposable SQLite DB",()=>{
 beforeAll(async()=>{if(db)await db.$connect();});
 beforeEach(async()=>{
  if(!db)return;
  await db.saleReturnLine.deleteMany();await db.saleReturn.deleteMany();
  await db.cashMovement.deleteMany();await db.stockMovement.deleteMany();
  await db.saleItem.deleteMany();await db.sale.deleteMany();
  await db.cashShift.deleteMany();await db.cashRegister.deleteMany();await db.product.deleteMany();
 });
 afterAll(async()=>{if(db)await db.$disconnect();});
 test("partial return restocks only selected quantity and deducts cash once",async()=>{
  const shift=await openCashShift(db!,actor,1000);
  const {p,sale}=await saleFixture();
  const input={requestId:randomUUID(),saleId:sale.id,approvedById:actor.id,
   reason:"Customer returned sealed item",lines:[{saleItemId:sale.items[0].id,quantity:1,restock:true}]};
  const first=await postCashReturn(db!,input);
  expect(first.replay).toBe(false);
  expect(first.returnRecord.refundCents).toBe(500);
  expect(first.returnRecord.shiftId).toBe(shift.id);
  const replay=await postCashReturn(db!,input);
  expect(replay.replay).toBe(true);
  expect(replay.returnRecord.id).toBe(first.returnRecord.id);
  expect((await db!.product.findUniqueOrThrow({where:{id:p.id}})).stockQty).toBe(18);
  expect((await db!.saleItem.findUniqueOrThrow({where:{id:sale.items[0].id}})).returnedQty).toBe(1);
  expect(await db!.cashMovement.count({where:{type:"REFUND"}})).toBe(1);
  expect(await db!.stockMovement.count({where:{reason:"CUSTOMER_RETURN"}})).toBe(1);
  await expect(postCashReturn(db!,{...input,reason:"Changed refund reason"})).rejects.toMatchObject({code:"REQUEST_CONFLICT"});
 });
 test("cannot over-return, refund without shift or refund more than recorded cash",async()=>{
  const {sale}=await saleFixture();
  const base={requestId:randomUUID(),saleId:sale.id,reason:"Item damaged",approvedById:actor.id,
    lines:[{saleItemId:sale.items[0].id,quantity:1,restock:false}]};
  await expect(postCashReturn(db!,base)).rejects.toMatchObject({code:"NO_OPEN_SHIFT"});
  await openCashShift(db!,actor,100);
  await expect(postCashReturn(db!,{...base,lines:[{...base.lines[0],quantity:4}]})).rejects.toMatchObject({code:"ALREADY_RETURNED"});
  // There is 1500 cents of recorded cash sales in this shift.
  const result=await postCashReturn(db!,{...base,lines:[{...base.lines[0],quantity:3}]});
  expect(result.returnRecord.refundCents).toBe(1500);
  expect(await db!.stockMovement.count({where:{reason:"CUSTOMER_RETURN"}})).toBe(0);
  expect(await db!.saleReturn.count()).toBe(1);
 });
});
describe("return calculation",()=>{
 it("uses the original sale unit price, not a new catalog price",()=>{
  expect(calculateRefund([{quantity:2,unitPriceCents:625}])).toBe(1250);
  expect(()=>calculateRefund([{quantity:0,unitPriceCents:625}])).toThrow();
 });
});
