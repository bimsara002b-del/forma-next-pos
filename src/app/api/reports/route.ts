import { permissionError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateReports, parseReportWindow, ReportInputError } from "@/lib/reports";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const denied = await permissionError("stock.manage");
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  try {
    const window = parseReportWindow(params.get("from"), params.get("to"));
    const result = await generateReports(prisma, window);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ReportInputError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    return Response.json({ error: "Reports are temporarily unavailable." }, { status: 500 });
  }
}
