import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/client";
import { authorizeTenantScope, TenantAccessDenied, type ScopeSelection,
  type AuthorizedTenantScope } from "../../../src/lib/saas/authorize-tenant";

export type SessionResolver = () => Promise<{ userId: string } | null>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateConnectionUrl(value: string | undefined): string {
  if (!value) throw new Error("SAAS_DATABASE_URL_REQUIRED");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("INVALID_SAAS_DATABASE_URL"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2)
    throw new Error("INVALID_SAAS_DATABASE_URL");
  return value;
}

/** Internal server DAL only. resolveSession must authenticate/recheck revocation;
 * never derive actor IDs from request bodies. Callbacks are trusted server code,
 * must enforce returned branch scope, and must use/await only the supplied tx.
 */
export function createTenantRuntime(options: {
  connectionString: string; resolveSession: SessionResolver; poolSize?: number;
}) {
  if ("window" in globalThis) throw new Error("SERVER_ONLY_RUNTIME");
  const max = options.poolSize ?? 4;
  if (!Number.isInteger(max) || max < 1 || max > 20) throw new Error("INVALID_POOL_SIZE");
  const client = new PrismaClient({ adapter: new PrismaPg({
    connectionString: validateConnectionUrl(options.connectionString), max,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000
  }) });
  async function withTenant<T>(selection: ScopeSelection,
    work: (tx: Prisma.TransactionClient, scope: AuthorizedTenantScope) => Promise<T>): Promise<T> {
    const actor = await options.resolveSession();
    if (!actor || !uuid.test(actor.userId)) throw new TenantAccessDenied("UNAUTHENTICATED");
    if (![selection.tenantId, selection.branchId, selection.registerId]
      .filter(value => value !== undefined).every(value => uuid.test(value!)))
      throw new TenantAccessDenied("FORBIDDEN");
    return client.$transaction(async tx => {
      const [role] = await tx.$queryRaw<{ unsafe: boolean }[]>`
        SELECT (r.rolsuper OR r.rolbypassrls OR EXISTS (
          SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='forma_saas' AND pg_has_role(current_user,c.relowner,'USAGE')
        )) AS unsafe FROM pg_roles r WHERE r.rolname=current_user`;
      if (!role || role.unsafe) throw new Error("UNSAFE_SAAS_DATABASE_ROLE");
      const [previous] = await tx.$queryRaw<{ tenant: string | null }[]>`
        SELECT nullif(current_setting('app.tenant_id', true), '') AS tenant`;
      if (previous?.tenant) throw new Error("DIRTY_TENANT_CONNECTION");
      // Bootstrap membership lookup only. Setting context is NOT authorization.
      // Business callback cannot run until live membership/assignment validation.
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${selection.tenantId}, true)`;
      const scope = await authorizeTenantScope(actor, selection, {
        findMembership: async (userId, tenantId) => {
          const m = await tx.tenantMembership.findUnique({
            where: { tenantId_userId: { tenantId, userId } },
            include: { branchAssignments: true, registerAssignments: true }
          });
          return m && { ...m, assignedBranchIds: m.branchAssignments.map(a => a.branchId),
            assignedRegisterIds: m.registerAssignments.map(a => a.registerId) };
        },
        findBranch: id => tx.branch.findUnique({ where: { tenantId_id: { tenantId: selection.tenantId, id } } }),
        findRegister: id => tx.register.findUnique({ where: { tenantId_id: { tenantId: selection.tenantId, id } } })
      });
      return work(tx, scope);
    }, { maxWait: 5000, timeout: 10000 });
  }
  return {
    withTenant,
    listProducts: (tenantId: string) => withTenant({ tenantId, capability: "products.read" },
      tx => tx.product.findMany({ where: { tenantId, isActive: true },
        select: { id: true, sku: true, barcode: true, name: true, priceMinor: true },
        orderBy: { id: "asc" }, take: 100 })),
    close: () => client.$disconnect()
  };
}
