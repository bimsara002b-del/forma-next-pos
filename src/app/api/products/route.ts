import { z } from "zod";
import { permissionError, mutationAuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
export const runtime = "nodejs";
const schema = z.object({
  sku: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(140),
  barcode: z.string().trim().max(80).optional(),
  category: z.string().trim().min(1).max(60),
  priceCents: z.number().int().min(1).max(100_000_000),
  costCents: z.number().int().min(0).max(100_000_000),
  stockQty: z.number().int().min(0).max(1_000_000)
}).strict();

export async function GET() {
  const denied=await permissionError("catalog.read"); if(denied)return denied;
  const products = await prisma.product.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  return Response.json({ products }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const denied=await permissionError("catalog.create"); if(denied)return denied;
  const originError = mutationAuthError(request);
  if (originError) return originError;
  let data: unknown;
  try { data = await request.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const parsed = schema.safeParse(data);
  if (!parsed.success) return Response.json({ error: "Invalid product details." }, { status: 400 });
  try {
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({ data: { ...parsed.data, barcode: parsed.data.barcode || null } });
      if (created.stockQty > 0) {
        await tx.stockMovement.create({ data: { productId: created.id, changeQty: created.stockQty, reason: "OPENING_STOCK" } });
      }
      return created;
    });
    return Response.json({ product }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") return Response.json({ error: "SKU or barcode already exists." }, { status: 409 });
    return Response.json({ error: "Could not add the product." }, { status: 500 });
  }
}
