import { z } from "zod";
import { getActor, mutationAuthError, permissionError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { InventoryFailure, receiveInventory, reconcileStockCount } from "@/lib/inventory";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const receive = z.object({
  action: z.literal("receive"), requestId: z.string().uuid(),
  supplierName: z.string().trim().min(2).max(100),
  reference: z.string().trim().min(2).max(80),
  lines: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().int().min(1).max(100000),
    unitCostCents: z.number().int().min(0).max(100000000)
  }).strict()).min(1).max(40)
}).strict();
const stockCount = z.object({
  action: z.literal("count"),
  productId: z.string().min(1),
  expectedQty: z.number().int().min(0).max(1000000),
  countedQty: z.number().int().min(0).max(1000000),
  reason: z.string().trim().min(3).max(120)
}).strict();
const requestSchema = z.discriminatedUnion("action", [receive, stockCount]);

export async function GET(request: Request) {
  const denied = await permissionError("stock.manage");
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const showInactive = params.get("includeInactive") === "true";
  const [products, recentReceipts, movements] = await Promise.all([
    prisma.product.findMany({
      where: showInactive ? {} : { isActive: true },
      orderBy: { name: "asc" }
    }),
    prisma.inventoryReceipt.findMany({
      take: 25, orderBy: { createdAt: "desc" },
      include: { lines: { select: { productName: true, quantity: true, unitCostCents: true } } }
    }),
    prisma.stockMovement.findMany({
      take: 30, orderBy: { createdAt: "desc" },
      include: { product: { select: { name: true } } }
    })
  ]);
  return Response.json({ products, recentReceipts, movements }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const denied = await permissionError("stock.manage");
  if (denied) return denied;
  const originError = mutationAuthError(request);
  if (originError) return originError;
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Sign in required." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const result = requestSchema.safeParse(body);
  if (!result.success) return Response.json({ error: "Invalid inventory details." }, { status: 400 });
  try {
    if (result.data.action === "receive") {
      const { action: _action, ...data } = result.data;
      void _action;
      const saved = await receiveInventory(prisma, { ...data, receivedById: actor.id });
      return Response.json(saved, { status: saved.replay ? 200 : 201, headers: { "Cache-Control": "no-store" } });
    }
    const { action: _action, ...data } = result.data;
    void _action;
    return Response.json(await reconcileStockCount(prisma, data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InventoryFailure) {
      const messages: Record<InventoryFailure["code"], string> = {
        INVALID_LINES: "Invalid quantities, cost prices or receipt details.",
        INVALID_PRODUCT: "One or more products are inactive or missing.",
        STOCK_OVERFLOW: "Receiving would exceed maximum supported stock.",
        REQUEST_CONFLICT: "Receipt ID already used with different details. Inspect inventory history.",
        RETRY_LATER: "Receipt status uncertain. Retry the same request without changing items.",
        STOCK_CHANGED: "Stock changed since you loaded the product. Refresh and recount."
      };
      return Response.json({ error: messages[error.code] }, { status:
        error.code === "INVALID_LINES" ? 422 : error.code === "RETRY_LATER" ? 503 : 409 });
    }
    return Response.json({ error: "Inventory update was not confirmed. Verify stock before retrying." }, { status: 500 });
  }
}
