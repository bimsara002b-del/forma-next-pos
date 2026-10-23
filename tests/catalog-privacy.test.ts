import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasPermission, type Role } from "../src/lib/staff";

const mocks = vi.hoisted(() => ({
  actor: { role: "CASHIER" as string | null },
  findMany: vi.fn()
}));
vi.mock("@/lib/db", () => ({ prisma: { product: { findMany: mocks.findMany } } }));
vi.mock("@/lib/auth", () => ({
  permissionError: async (permission: Parameters<typeof hasPermission>[1]) => {
    if (!mocks.actor.role) return Response.json({}, { status: 401 });
    return hasPermission(mocks.actor.role as Role, permission)
      ? null : Response.json({}, { status: 403 });
  },
  mutationAuthError: vi.fn()
}));
import { GET } from "../src/app/api/products/route";

const row = { id: "p1", sku: "001", barcode: "000123", name: "Tea",
  category: "General", priceCents: 500, costCents: 275, stockQty: 4,
  minStockQty: 5, isActive: true, privateSupplierNote: "confidential" };

beforeEach(() => {
  mocks.actor.role = "CASHIER";
  mocks.findMany.mockReset();
  // Model Prisma's select behavior against a record containing private fields.
  mocks.findMany.mockImplementation(async ({ select }) => [Object.fromEntries(
    Object.entries(row).filter(([key]) => select?.[key] === true)
  )]);
});

describe("catalog API field privacy", () => {
  it.each(["CASHIER", "MANAGER", "OWNER"])("returns only checkout fields for %s", async role => {
    mocks.actor.role = role;
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body.products).toEqual([{ id: "p1", sku: "001", barcode: "000123",
      name: "Tea", category: "General", priceCents: 500, stockQty: 4,
      minStockQty: 5, isActive: true }]);
    expect(mocks.findMany.mock.calls[0][0].select).not.toHaveProperty("costCents");
    expect(JSON.stringify(body)).not.toContain("privateSupplierNote");
  });
  it.each([[null, 401], ["SUPER_ADMIN", 403]])("denies %s before reading products", async (role, status) => {
    mocks.actor.role = role as string | null;
    expect((await GET()).status).toBe(status);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
  it("keeps cost-bearing inventory endpoints restricted to store managers", () => {
    expect(hasPermission("CASHIER", "stock.manage")).toBe(false);
    expect(hasPermission("SUPER_ADMIN", "stock.manage")).toBe(false);
    expect(hasPermission("MANAGER", "stock.manage")).toBe(true);
    expect(hasPermission("OWNER", "stock.manage")).toBe(true);
  });
});
