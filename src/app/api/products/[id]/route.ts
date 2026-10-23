import { z } from "zod";
import { permissionError, mutationAuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
export const runtime = "nodejs";
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"),
    name: z.string().trim().min(1).max(140),
    sku: z.string().trim().min(1).max(40),
    barcode: z.string().trim().max(80).nullable(),
    category: z.string().trim().min(1).max(60),
    priceCents: z.number().int().min(1).max(100000000),
    costCents: z.number().int().min(0).max(100000000),
    minStockQty: z.number().int().min(0).max(1000000)
  }).strict(),
  z.object({ action: z.literal("archive") }).strict(),
  z.object({ action: z.literal("restore") }).strict()
]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await permissionError("catalog.create");
  if (denied) return denied;
  const error = mutationAuthError(request);
  if (error) return error;
  const { id } = await context.params;
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const checked = input.safeParse(body);
  if (!checked.success) return Response.json({ error: "Invalid product changes." }, { status: 400 });
  try {
    const { action } = checked.data;
    const original = await prisma.product.findUnique({ where: { id } });
    if (!original) return Response.json({ error: "Product not found." }, { status: 404 });
    if (action === "archive" && !original.isActive || action === "restore" && original.isActive)
      return Response.json({ error: "Product is already in that state." }, { status: 409 });
    const product = await prisma.product.update({
      where: { id },
      data: action === "edit" ? {
        name: checked.data.name, sku: checked.data.sku,
        barcode: checked.data.barcode || null, category: checked.data.category,
        priceCents: checked.data.priceCents, costCents: checked.data.costCents,
        minStockQty: checked.data.minStockQty
      } : { isActive: action === "restore" }
    });
    return Response.json({ product }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (typeof err === "object" && err && "code" in err && err.code === "P2002")
      return Response.json({ error: "SKU or barcode already exists." }, { status: 409 });
    return Response.json({ error: "Product could not be updated." }, { status: 500 });
  }
}
