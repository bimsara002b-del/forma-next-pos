import { z } from "zod";
import { getActor, mutationAuthError, permissionError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { adjustInventoryStock, StockAdjustmentFailure } from "@/lib/inventory";
export const runtime = "nodejs";

const schema = z.object({
  requestId: z.string().uuid(),
  productId: z.string().min(1),
  expectedQty: z.number().int().min(0).max(1_000_000),
  delta: z.number().int().min(-100_000).max(100_000).refine(value => value !== 0),
  reason: z.enum(["FOUND", "LOSS", "DAMAGE", "CORRECTION"]),
  note: z.string().trim().min(4).max(160)
}).strict();

export async function POST(request: Request) {
  const denied = await permissionError("stock.manage");
  if (denied) return denied;
  const originError = mutationAuthError(request);
  if (originError) return originError;
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Please sign in again." }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid adjustment. Include request ID, expected stock, quantity, category and note." }, { status: 400 });
  }
  try {
    const result = await adjustInventoryStock(prisma, { ...parsed.data, performedById: actor.id });
    return Response.json({
      movement: {
        id: result.movement.id,
        productId: result.movement.productId,
        beforeQty: result.movement.beforeQty,
        afterQty: result.movement.afterQty,
        changeQty: result.movement.changeQty,
        reason: result.movement.reason,
        note: result.movement.note
      }, replay: result.replay
    }, { status: result.replay ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StockAdjustmentFailure) {
      const messages: Record<StockAdjustmentFailure["code"], string> = {
        INVALID_ADJUSTMENT: "Invalid stock quantity or incompatible adjustment reason.",
        PRODUCT_UNAVAILABLE: "Product is archived or no longer available.",
        STOCK_CHANGED: "Stock changed since you loaded the product. Refresh before retrying.",
        REQUEST_CONFLICT: "This adjustment ID was already used for different stock details.",
        RETRY_LATER: "Adjustment outcome uncertain. Retry with the exact same details."
      };
      return Response.json({ error: messages[error.code] }, {
        status: error.code === "INVALID_ADJUSTMENT" ? 422 :
          error.code === "RETRY_LATER" ? 503 : 409
      });
    }
    return Response.json({
      error: "Adjustment status unconfirmed. Check the ledger and retry only the same request ID and details."
    }, { status: 500 });
  }
}
