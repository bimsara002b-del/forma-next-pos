import { z } from "zod";
import { permissionError, mutationAuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
export const runtime = "nodejs";
const schema = z.object({ productId: z.string().min(1), delta: z.number().int().min(-100_000).max(100_000).refine(v => v !== 0), reason: z.enum(["RECEIVING", "ADJUSTMENT"]) }).strict();
export async function POST(request: Request) {
  const denied=await permissionError("stock.manage"); if(denied)return denied;
  const originError = mutationAuthError(request);
  if (originError) return originError;
  let data: unknown;
  try { data = await request.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const parsed = schema.safeParse(data);
  if (!parsed.success) return Response.json({ error: "Invalid stock update." }, { status: 400 });
  try {
    const product = await prisma.$transaction(async (tx) => {
      const { productId, delta, reason } = parsed.data;
      const result = await tx.product.updateMany({
        where: { id: productId, isActive: true, stockQty: delta < 0 ? { gte: -delta } : { lte: 1_000_000 - delta } },
        data: { stockQty: delta > 0 ? { increment: delta } : { decrement: -delta } }
      });
      if (result.count !== 1) throw new Error("STOCK_CONFLICT");
      await tx.stockMovement.create({ data: { productId, changeQty: delta, reason } });
      return tx.product.findUniqueOrThrow({ where: { id: productId } });
    });
    return Response.json({ product });
  } catch {
    return Response.json({ error: "Stock adjustment rejected. Check available stock." }, { status: 409 });
  }
}
