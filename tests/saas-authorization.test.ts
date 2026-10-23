import { describe, expect, it } from "vitest";
import {
  authorizeTenantScope, TenantAccessDenied,
  type Membership, type TenantScopeStore
} from "../src/lib/saas/authorize-tenant";

const TENANT_A = "tenant-a", TENANT_B = "tenant-b";
function store(membership: Membership | null, branchTenant=TENANT_A, registerTenant=TENANT_A): TenantScopeStore {
  return {
    findMembership: async () => membership,
    findBranch: async id => ({ id, tenantId: branchTenant, isActive: true }),
    findRegister: async id => ({ id, tenantId: registerTenant, branchId: "branch-a", isActive: true })
  };
}
const alice = { userId: "alice" };
const assigned: Membership = {
  id: "member-a", userId: "alice", tenantId: TENANT_A,
  status: "ACTIVE", role: "CASHIER", assignedBranchIds: ["branch-a"],
  assignedRegisterIds: ["register-a"]
};
const checkout = { tenantId: TENANT_A, branchId: "branch-a", registerId: "register-a", capability: "checkout.create" as const };

describe("tenant authorization boundary (server-only contract)", () => {
  it("fails closed for no authenticated actor", async () => {
    await expect(authorizeTenantScope(null, checkout, store(assigned)))
      .rejects.toMatchObject({ reason: "UNAUTHENTICATED" });
  });
  it("rechecks membership and rejects forged tenant selection", async () => {
    await expect(authorizeTenantScope(alice, { ...checkout, tenantId: TENANT_B }, store(assigned)))
      .rejects.toBeInstanceOf(TenantAccessDenied);
  });
  it("rejects revoked membership and unknown roles", async () => {
    await expect(authorizeTenantScope(alice, checkout, store({ ...assigned, status: "REVOKED" })))
      .rejects.toMatchObject({ reason: "FORBIDDEN" });
    await expect(authorizeTenantScope(alice, checkout, store({ ...assigned, role: "SUPER_ADMIN" })))
      .rejects.toMatchObject({ reason: "FORBIDDEN" });
  });
  it("never inherits owner permissions from another tenant", async () => {
    await expect(authorizeTenantScope(alice, { tenantId: TENANT_A, capability: "staff.manage" }, store(assigned)))
      .rejects.toMatchObject({ reason: "FORBIDDEN" });
  });
  it("rejects cross-tenant branch/register IDs even when membership exists", async () => {
    await expect(authorizeTenantScope(alice, checkout, store(assigned, TENANT_B)))
      .rejects.toMatchObject({ reason: "FORBIDDEN" });
    await expect(authorizeTenantScope(alice, checkout, store(assigned, TENANT_A, TENANT_B)))
      .rejects.toMatchObject({ reason: "FORBIDDEN" });
    await expect(authorizeTenantScope(alice, { ...checkout, registerId: "register-other" }, store(assigned)))
      .rejects.toMatchObject({ reason: "FORBIDDEN" });
  });
  it("requires scoped register and branch for checkout", async () => {
    await expect(authorizeTenantScope(alice, { tenantId: TENANT_A, capability: "checkout.create" }, store(assigned)))
      .rejects.toMatchObject({ reason: "FORBIDDEN" });
  });
  it("authorizes assigned cashier, returning only verified scope", async () => {
    await expect(authorizeTenantScope(alice, checkout, store(assigned))).resolves.toEqual({
      userId: "alice", membershipId: "member-a", tenantId: TENANT_A,
      role: "CASHIER", branchId: "branch-a", registerId: "register-a",
      capability: "checkout.create"
    });
  });
  it("owner is tenant-scoped, never platform-wide", async () => {
    const owner = { ...assigned, role: "OWNER", assignedBranchIds: [], assignedRegisterIds: [] };
    await expect(authorizeTenantScope(alice, checkout, store(owner))).resolves.toMatchObject({ role: "OWNER" });
    await expect(authorizeTenantScope(alice, { ...checkout, tenantId: TENANT_B }, store(owner)))
      .rejects.toMatchObject({ reason: "FORBIDDEN" });
  });
  it.each(["branches.read", "inventory.read", "sales.read", "reports.read"] as const)(
    "requires an assigned branch for manager %s", async capability => {
      const manager = { ...assigned, role: "MANAGER" };
      await expect(authorizeTenantScope(alice, { tenantId: TENANT_A, capability }, store(manager)))
        .rejects.toMatchObject({ reason: "FORBIDDEN" });
      await expect(authorizeTenantScope(alice, { tenantId: TENANT_A, branchId: "other", capability }, store(manager)))
        .rejects.toMatchObject({ reason: "FORBIDDEN" });
      await expect(authorizeTenantScope(alice, { tenantId: TENANT_A, branchId: "branch-a", capability }, store(manager)))
        .resolves.toMatchObject({ branchId: "branch-a" });
    }
  );
  it("allows owner aggregate reports within the verified tenant", async () => {
    await expect(authorizeTenantScope(alice, { tenantId: TENANT_A, capability: "reports.read" },
      store({ ...assigned, role: "OWNER" }))).resolves.toMatchObject({ tenantId: TENANT_A, branchId: null });
  });
  it("rejects inactive branches and a register belonging to another branch", async () => {
    const inactive = store(assigned);
    inactive.findBranch = async id => ({ id, tenantId: TENANT_A, isActive: false });
    await expect(authorizeTenantScope(alice, checkout, inactive)).rejects.toBeInstanceOf(TenantAccessDenied);
    const wrongBranch = store(assigned);
    wrongBranch.findRegister = async id => ({ id, tenantId: TENANT_A, branchId: "other", isActive: true });
    await expect(authorizeTenantScope(alice, checkout, wrongBranch)).rejects.toBeInstanceOf(TenantAccessDenied);
  });
});
