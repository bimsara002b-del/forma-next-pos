# P02 — Tenant lifecycle authorization guard (2026-10-24)

Source: https://app.notion.com/p/401eb6880047818d9a5cd337711a98b2

## Scope
The opt-in PostgreSQL/Prisma 7 tenant DAL now reads the tenant row in the same transaction as membership and branch/register checks. Tenant status is not trusted from request parameters.

## Security behavior (policy until billing gate is finalized)
- TRIALING, ACTIVE, PAST_DUE, GRACE: allow only role-permitted operations. Grace deadlines and plan quota enforcement remain separate unfinished gates.
- SUSPENDED, CANCELLED: deny mutation capabilities; allow individually authorized `branches.read`, `products.read`, `inventory.read`, `sales.read` and `reports.read`. This supports safe historic access without allowing checkout, inventory writes, refunds or staff/tenant changes.
- Missing tenant, wrong tenant, unknown status, revoked membership or missing assignment: deny.
- Reads do not override any per-role or branch restrictions. No global admin bypass.
- Platform billing recovery and data export policy remain TODO, not introduced by this change.

## Verification
- Unit regressions: tenant lifecycle states; unknown/missing/wrong tenant; suspended read-only vs writes.
- PostgreSQL integration regression on an isolated test DB: suspended checkout denied, authorized catalog read remains, another tenant unchanged, state restored.
- Separate integration test fixture restores register assignment after revocation test.
- Run `npm test` and `npm run typecheck`; PostgreSQL integration needs the repository's disposable local test DB setup.
- No database schema change, migration execution, deployment or legacy SQLite cutover.

## Remaining architecture launch blockers
Production-grade identity/HTTP session integration, tenant-safe finance DAL cutover for all live routes, complete billing state transitions and entitlements, robust RLS/role/pool tests, backup/restore rehearsal and pilot signoff.
