import { z } from "zod";
import { getActor, mutationAuthError, permissionError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createPurchaseOrder, procurementOverview, ProcurementFailure, transitionPurchaseOrder } from "@/lib/procurement";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const supplierSchema=z.object({
  action:z.literal("supplier-create"),name:z.string().trim().min(2).max(100),
  contactName:z.string().trim().max(100).optional(),
  phone:z.string().trim().max(40).optional(),email:z.union([z.literal(""),z.string().email().max(160)]).optional()
}).strict();
const orderSchema=z.object({
  action:z.literal("order-create"),supplierId:z.string().min(1),
  notes:z.string().trim().max(250).optional(),
  lines:z.array(z.object({productId:z.string().min(1),
    quantityOrdered:z.number().int().min(1).max(100000),
    unitCostCents:z.number().int().min(0).max(100000000)}).strict()).min(1).max(40)
}).strict();
const transitionSchema=z.object({
  action:z.enum(["place","cancel"]),orderId:z.string().min(1)
}).strict();
const command=z.discriminatedUnion("action",[supplierSchema,orderSchema,transitionSchema]);
export async function GET(){
  const denied=await permissionError("stock.manage");if(denied)return denied;
  return Response.json(await procurementOverview(prisma),{headers:{"Cache-Control":"no-store"}});
}
export async function POST(request:Request){
  const denied=await permissionError("stock.manage");if(denied)return denied;
  const origin=mutationAuthError(request);if(origin)return origin;
  const actor=await getActor();if(!actor)return Response.json({error:"Sign in required."},{status:401});
  let raw:unknown;try{raw=await request.json();}catch{return Response.json({error:"Invalid JSON."},{status:400});}
  const parsed=command.safeParse(raw);
  if(!parsed.success)return Response.json({error:"Invalid supplier/purchase order data."},{status:400});
  try{
    const input=parsed.data;
    if(input.action==="supplier-create"){
      const supplier=await prisma.supplier.create({data:{
        name:input.name,contactName:input.contactName||null,
        phone:input.phone||null,email:input.email||null
      }});
      return Response.json({supplier},{status:201});
    }
    if(input.action==="order-create"){
      const order=await createPurchaseOrder(prisma,{supplierId:input.supplierId,
        createdById:actor.id,notes:input.notes,lines:input.lines});
      return Response.json({order},{status:201});
    }
    return Response.json({order:await transitionPurchaseOrder(prisma,input.orderId,input.action)});
  }catch(error){
    if(error instanceof ProcurementFailure){
      const messages:Record<ProcurementFailure["code"],string>={
        INVALID_LINES:"Invalid or duplicate product lines or purchase total.",
        INVALID_SUPPLIER:"Supplier is inactive or not found.",
        INVALID_PRODUCT:"One or more products are missing or archived.",
        INVALID_STATUS:"Purchase order cannot change to that status.",
        ORDER_NOT_FOUND:"Purchase order not found.",
        QUANTITY_CONFLICT:"Received quantity exceeds ordered quantity.",
        ORDER_BUSY:"Order was updated concurrently. Refresh and retry."
      };
      return Response.json({error:messages[error.code]},{status:error.code==="INVALID_LINES"?422:409});
    }
    if(typeof error==="object"&&error!==null&&"code" in error&&error.code==="P2002")
      return Response.json({error:"Supplier name already exists."},{status:409});
    return Response.json({error:"Procurement request could not be confirmed."},{status:500});
  }
}
