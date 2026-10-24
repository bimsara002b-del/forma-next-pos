/**
 * Milestone 26: fail-closed tenant authorization contract.
 *
 * NOT wired to legacy SQLite endpoints. Call only from trusted server services,
 * using a session-verified actor and live DB membership/assignments.
 * Client-provided tenant/branch/register IDs are lookup hints, never proof.
 */
export type TenantRole = "OWNER" | "MANAGER" | "CASHIER" | "INVENTORY_CLERK";
export type TenantCapability =
  | "tenant.manage" | "staff.manage" | "branches.read"
  | "products.read" | "products.write" | "inventory.read"
  | "inventory.adjust" | "checkout.create" | "sales.read"
  | "sales.refund.approve" | "reports.read";

type Actor = { userId: string };
export type Membership = {
  id: string;
  userId: string;
  tenantId: string;
  role: string;
  status: string;
  assignedBranchIds: readonly string[];
  assignedRegisterIds: readonly string[];
};
type ScopedTenant = { id: string; status: string };
type ScopedBranch = { id: string; tenantId: string; isActive: boolean };
type ScopedRegister = { id: string; tenantId: string; branchId: string; isActive: boolean };
export type TenantScopeStore = {
  findMembership(userId: string, tenantId: string): Promise<Membership | null>;
  findTenant(tenantId: string): Promise<ScopedTenant | null>;
  findBranch(branchId: string): Promise<ScopedBranch | null>;
  findRegister(registerId: string): Promise<ScopedRegister | null>;
};
export type ScopeSelection = {
  tenantId: string;
  branchId?: string;
  registerId?: string;
  capability: TenantCapability;
};
export type AuthorizedTenantScope = Readonly<{
  userId: string;
  membershipId: string;
  tenantId: string;
  role: TenantRole;
  branchId: string | null;
  registerId: string | null;
  capability: TenantCapability;
}>;

export class TenantAccessDenied extends Error {
  constructor(public readonly reason: "UNAUTHENTICATED" | "FORBIDDEN") {
    super(reason);
    this.name = "TenantAccessDenied";
  }
}
const policy: Readonly<Record<TenantRole, readonly TenantCapability[]>> = {
  OWNER: [
    "tenant.manage", "staff.manage", "branches.read", "products.read",
    "products.write", "inventory.read", "inventory.adjust", "checkout.create",
    "sales.read", "sales.refund.approve", "reports.read"
  ],
  MANAGER: [
    "branches.read", "products.read", "products.write", "inventory.read",
    "inventory.adjust", "checkout.create", "sales.read",
    "sales.refund.approve", "reports.read"
  ],
  CASHIER: ["products.read", "checkout.create", "sales.read"],
  INVENTORY_CLERK: ["products.read", "products.write", "inventory.read", "inventory.adjust"]
};
// A paused tenant retains only explicitly permissioned, non-mutating access.
// Billing's grace deadlines and feature entitlements remain separate P0 gates.
const writableTenantStatuses = new Set(["TRIALING", "ACTIVE", "PAST_DUE", "GRACE"]);
const readOnlyTenantStatuses = new Set(["SUSPENDED", "CANCELLED"]);
const readOnlyCapabilities = new Set<TenantCapability>([
  "branches.read", "products.read", "inventory.read", "sales.read", "reports.read"
]);
const branchMandatory = new Set<TenantCapability>(["inventory.adjust", "checkout.create", "sales.refund.approve"]);
// Non-owner reads must not turn missing branch selection into tenant-wide access.
const branchScopedReads = new Set<TenantCapability>(["branches.read", "inventory.read", "sales.read", "reports.read"]);
const isNonEmpty = (value: string | undefined): value is string =>
  typeof value === "string" && value.length > 0 && value.trim() === value;
function isTenantRole(role: string): role is TenantRole {
  return Object.prototype.hasOwnProperty.call(policy, role);
}
function forbidden(): never {
  throw new TenantAccessDenied("FORBIDDEN");
}

/**
 * Authorization MUST precede ALL scoped DAL queries and business mutations.
 * Caller must independently validate session and CSRF; never trust role/IDs
 * supplied by a browser. Every call reloads active membership.
 */
export async function authorizeTenantScope(
  actor: Actor | null,
  selection: ScopeSelection,
  store: TenantScopeStore
): Promise<AuthorizedTenantScope> {
  if (!actor || !isNonEmpty(actor.userId)) throw new TenantAccessDenied("UNAUTHENTICATED");
  if (!isNonEmpty(selection.tenantId) ||
      (selection.branchId !== undefined && !isNonEmpty(selection.branchId)) ||
      (selection.registerId !== undefined && !isNonEmpty(selection.registerId))) forbidden();

  const membership = await store.findMembership(actor.userId, selection.tenantId);
  if (!membership || membership.userId !== actor.userId ||
      membership.tenantId !== selection.tenantId ||
      membership.status !== "ACTIVE" || !isTenantRole(membership.role)) forbidden();
  if (!policy[membership.role].includes(selection.capability)) forbidden();
  // Tenant state comes from the same trusted transaction as membership. Never
  // accept a request-side state or silently allow an unknown/future state.
  const tenant = await store.findTenant(selection.tenantId);
  if (!tenant || tenant.id !== selection.tenantId ||
      (!writableTenantStatuses.has(tenant.status) &&
       !(readOnlyTenantStatuses.has(tenant.status) &&
         readOnlyCapabilities.has(selection.capability)))) forbidden();
  if (branchMandatory.has(selection.capability) && !selection.branchId) forbidden();
  if (membership.role !== "OWNER" && branchScopedReads.has(selection.capability) && !selection.branchId) forbidden();
  if (selection.registerId && !selection.branchId) forbidden();
  if (selection.capability === "checkout.create" && !selection.registerId) forbidden();

  if (selection.branchId) {
    const branch = await store.findBranch(selection.branchId);
    if (!branch || !branch.isActive || branch.tenantId !== selection.tenantId ||
        branch.id !== selection.branchId) forbidden();
    if (membership.role !== "OWNER" &&
        !membership.assignedBranchIds.includes(selection.branchId)) forbidden();
  }
  if (selection.registerId) {
    const register = await store.findRegister(selection.registerId);
    if (!register || !register.isActive || register.tenantId !== selection.tenantId ||
        register.id !== selection.registerId || register.branchId !== selection.branchId) forbidden();
    if (membership.role !== "OWNER" &&
        !membership.assignedRegisterIds.includes(selection.registerId)) forbidden();
  }

  return Object.freeze({
    userId: actor.userId, membershipId: membership.id,
    tenantId: membership.tenantId, role: membership.role,
    branchId: selection.branchId ?? null,
    registerId: selection.registerId ?? null,
    capability: selection.capability
  });
}
