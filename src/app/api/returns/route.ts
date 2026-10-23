import { z } from "zod";
import { getActor, mutationAuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { postCashReturn, ReturnFailure } from "@/lib/returns";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  requestId: z.string().uuid(), saleId: z.string().min(1),
  reason: z.string().trim().min(4).max(160),
  lines: z.array(z.object({
    saleItemId: z.string().min(1), quantity: z.number().int().min(1).max(1000),
    restock: z.boolean()
  }).strict()).min(1).max(100)
}).strict();

async function manager() {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (actor.role !== "MANAGER" && actor.role !== "OWNER")
    return Response.json({ error: "Manager approval required for refunds." }, { status: 403 });
  return actor;
}
export async function GET(request: Request) {
  const actor = await manager();
  if (actor instanceof Response) return actor;
  const saleId = new URL(request.url).searchParams.get("saleId");
  if (!saleId || saleId.length > 150) return Response.json({ error: "Sale ID required." }, { status: 400 });
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    select: {
      id: true, receiptNumber: true, paymentMethod: true, totalCents: true, createdAt: true,
      items: { select: { id: true, productName: true, quantity: true, returnedQty: true,
        unitPriceCents: true, lineTotalCents: true } },
      returns: { take: 20, orderBy: { createdAt: "desc" }, select: {
        id: true, returnNumber: true, refundCents: true, reason: true, createdAt: true
      } }
    }
  });
  if (!sale) return Response.json({ error: "Sale not found." }, { status: 404 });
  return Response.json({ sale }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const actor = await manager();
  if (actor instanceof Response) return actor;
  const originError = mutationAuthError(request);
  if (originError) return originError;
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const input = requestSchema.safeParse(raw);
  if (!input.success) return Response.json({ error: "Invalid return details." }, { status: 400 });
  try {
    const saved = await postCashReturn(prisma, { ...input.data, approvedById: actor.id });
    return Response.json({
      id: saved.returnRecord.id,
      returnNumber: saved.returnRecord.returnNumber,
      refundCents: saved.returnRecord.refundCents,
      replay: saved.replay
    }, { status: saved.replay ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch(error) {
    if (error instanceof ReturnFailure) {
      const messages: Record<ReturnFailure["code"], string> = {
        INVALID_RETURN: "Return details or reason are invalid.",
        SALE_NOT_FOUND: "Original sale was not found.",
        NOT_CASH_SALE: "Only original cash sales can be refunded in this demo.",
        LINE_NOT_FOUND: "A returned item does not belong to that sale.",
        ALREADY_RETURNED: "Requested quantity was already returned. Refresh the original sale.",
        REFUND_OVERFLOW: "Refund amount exceeds supported bounds.",
        RESTOCK_UNAVAILABLE: "Product is archived or stock limit would be exceeded.",
        NO_OPEN_SHIFT: "Open a cash register shift before recording a cash refund.",
        INSUFFICIENT_DRAWER_CASH: "Insufficient recorded drawer cash for this refund.",
        REQUEST_CONFLICT: "This refund request ID was already used with different details.",
        RETRY_LATER: "Refund status uncertain. Retry the same request without changing items."
      };
      return Response.json({ error: messages[error.code] }, {
        status: error.code === "INVALID_RETURN" || error.code === "REFUND_OVERFLOW" ? 422 :
          error.code === "RETRY_LATER" ? 503 : 409
      });
    }
    return Response.json({
      error: "Refund status unconfirmed. Check the return history and retry with the SAME request ID."
    }, { status: 500 });
  }
}
