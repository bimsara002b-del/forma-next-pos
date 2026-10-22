import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authError, isAuthenticated, mutationAuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sumLines } from "@/lib/money";
export const runtime = "nodejs";
const checkoutSchema = z.object({
  requestId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().int().min(1).max(1000)
  }).strict()).min(1).max(100),
  receivedCents: z.number().int().nonnegative().max(2_000_000_000)
}).strict();

function toReceipt(sale: {
  id: string; receiptNumber: string; totalCents: number; receivedCents: number; changeCents: number;
  createdAt: Date; items: { productName: string; quantity: number; unitPriceCents: number; lineTotalCents: number }[];
}) {
  return { id: sale.id, receiptNumber: sale.receiptNumber, totalCents: sale.totalCents,
    receivedCents: sale.receivedCents, changeCents: sale.changeCents, paymentMethod: "CASH",
    createdAt: sale.createdAt.toISOString(), items: sale.items.map(item => ({
      productName: item.productName, quantity: item.quantity,
      unitPriceCents: item.unitPriceCents, lineTotalCents: item.lineTotalCents
    }))
  };
}
export async function POST(request: Request) {
  if (!await isAuthenticated()) return authError();
  const originError = mutationAuthError(request);
  if (originError) return originError;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const checked = checkoutSchema.safeParse(body);
  if (!checked.success) return Response.json({ error: "Invalid sale details." }, { status: 400 });
  const { requestId, receivedCents } = checked.data;
  const quantities = new Map<string, number>();
  for (const item of checked.data.items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  if ([...quantities.values()].some(q => q > 1000)) return Response.json({ error: "Quantity limit exceeded." }, { status: 400 });
  try {
    const sale = await prisma.$transaction(async tx => {
      const existing = await tx.sale.findUnique({ where: { requestId }, include: { items: true } });
      if (existing) return existing;
      const products = await tx.product.findMany({ where: { id: { in: [...quantities.keys()] }, isActive: true } });
      if (products.length !== quantities.size) throw new Error("PRODUCT_UNAVAILABLE");
      const lines = products.map(product => {
        const quantity = quantities.get(product.id)!;
        if (product.priceCents < 0) throw new Error("INVALID_PRICE");
        return { productId: product.id, productName: product.name, quantity,
          unitPriceCents: product.priceCents, lineTotalCents: product.priceCents * quantity };
      });
      const totalCents = sumLines(lines);
      if (receivedCents < totalCents) throw new Error("UNDERPAYMENT");
      for (const line of lines) {
        const changed = await tx.product.updateMany({
          where: { id: line.productId, isActive: true, stockQty: { gte: line.quantity } },
          data: { stockQty: { decrement: line.quantity } }
        });
        if (changed.count !== 1) throw new Error("OUT_OF_STOCK");
      }
      const created = await tx.sale.create({
        data: {
          requestId, receiptNumber: "FP-" + new Date().toISOString().slice(0,10).replaceAll("-","") + "-" + randomUUID().slice(0,8).toUpperCase(),
          totalCents, receivedCents, changeCents: receivedCents - totalCents,
          items: { create: lines }
        },
        include: { items: true }
      });
      await tx.stockMovement.createMany({
        data: lines.map(line => ({ productId: line.productId, changeQty: -line.quantity,
          reason: "SALE", reference: created.receiptNumber }))
      });
      return created;
    });
    return Response.json({ sale: toReceipt(sale) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // A concurrent retry may reach the uniqueness check; retrieve the completed sale.
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
      const sale = await prisma.sale.findUnique({ where: { requestId }, include: { items: true } });
      if (sale) return Response.json({ sale: toReceipt(sale) }, { status: 200 });
    }
    const message = error instanceof Error ? error.message : "";
    if (message === "UNDERPAYMENT") return Response.json({ error: "Received amount is below the total." }, { status: 422 });
    if (["PRODUCT_UNAVAILABLE", "OUT_OF_STOCK"].includes(message)) return Response.json({ error: "Product or stock changed. Refresh and retry." }, { status: 409 });
    if (["TOTAL_EXCEEDED", "INVALID_PRICE"].includes(message)) return Response.json({ error: "Sale total not supported." }, { status: 422 });
    return Response.json({ error: "Checkout was not confirmed. Keep the cart and retry the same request." }, { status: 500 });
  }
}
