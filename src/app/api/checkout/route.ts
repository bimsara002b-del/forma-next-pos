import { z } from "zod";
import { permissionError, mutationAuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { commitCashCheckout, CheckoutFailure } from "@/lib/checkout";
export const runtime = "nodejs";

const checkoutSchema = z.object({
  requestId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().int().min(1).max(1000)
  }).strict()).min(1).max(100),
  receivedCents: z.number().int().nonnegative().max(2_000_000_000)
}).strict();

export async function POST(request: Request) {
  const denied=await permissionError("checkout"); if(denied)return denied;
  const originError = mutationAuthError(request);
  if (originError) return originError;
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const checked = checkoutSchema.safeParse(body);
  if (!checked.success) return Response.json({ error: "Invalid checkout data." }, { status: 400 });

  try {
    const { sale, replay } = await commitCashCheckout(prisma, checked.data);
    return Response.json({
      sale: {
        id: sale.id, receiptNumber: sale.receiptNumber,
        totalCents: sale.totalCents, receivedCents: sale.receivedCents,
        changeCents: sale.changeCents, paymentMethod: sale.paymentMethod,
        createdAt: sale.createdAt.toISOString(),
        items: sale.items.map(line => ({
          productName: line.productName,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          lineTotalCents: line.lineTotalCents
        }))
      },
      replay
    }, { status: replay ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CheckoutFailure) {
      switch (error.code) {
        case "REQUEST_CONFLICT":
          return Response.json({ error: "This checkout ID was already used for a different order. Verify existing receipts before creating a new checkout." }, { status: 409 });
        case "PRODUCT_UNAVAILABLE":
        case "STOCK_CHANGED":
          return Response.json({ error: "Product or stock changed. Refresh and retry." }, { status: 409 });
        case "SHIFT_REQUIRED":
          return Response.json({ error: "Open a cash shift before completing a sale." }, { status: 409 });
        case "RETRY_LATER":
          return Response.json({ error: "Sale status uncertain. Retry with the same checkout ID and unchanged cart/tender." }, { status: 503 });
        case "PAYMENT_SHORT":
          return Response.json({ error: "Cash received does not cover the total." }, { status: 422 });
        default:
          return Response.json({ error: "Invalid sale quantity or total." }, { status: 422 });
      }
    }
    return Response.json({
      error: "Sale status is not confirmed. Retry with the same checkout ID and unchanged cart/tender."
    }, { status: 500 });
  }
}
