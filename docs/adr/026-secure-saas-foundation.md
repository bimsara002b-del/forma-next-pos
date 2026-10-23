# ADR-026: Secure SaaS architecture foundation (opt-in, no cutover)

Status: proposed implementation foundation, not live tenancy
Date: 2026-10-23
Sources:
- Notion master: https://app.notion.com/p/401eb688004781d4b50ef4f5577e8ebe
- Notion architecture: https://app.notion.com/p/401eb6880047818d9a5cd337711a98b2
- Notion backlog: https://app.notion.com/p/401eb6880047814ca2c3d69eb34b37e2
- Notion RBAC: https://app.notion.com/p/401eb6880047811e87d7fc6027c0c694

## Decision and scope

Keep existing Next.js 16 / Prisma 6 / SQLite cashier, inventory, returns,
staff and Super Admin routes intact. Introduce a SEPARATE PostgreSQL schema
reference under prisma/saas with tenant, membership, branch, register, product,
sale, sale line, stock balance and movement. Includes composite tenant keys
and FORCE ROW LEVEL SECURITY with a deny-by-default tenant GUC. Add a
testable server-side authorization contract under src/lib/saas; it is NOT
wired to production routes yet. Prisma 7 target schema is for a later runtime
cutover with a pinned version, separate config, adapter, migrations and lockfile.
No runtime PostgreSQL connection, login migration or customer data transfer
occurs in M26.

The tenant RLS variable is a defense layer, NOT authenticated authority:
a custom PostgreSQL GUC can be set by any SQL client. Only server code
that revalidates the user's current membership and branch/register access
may enter a transaction and set the tenant context with
set_config('app.tenant_id', verified_id, true). Never use is_local=false.
Run all tenant data calls in THAT same transaction; use a dedicated app role
which does not own tables and lacks SUPERUSER/BYPASSRLS. Platform identity
tables require a separately authorized identity-service access path.
Future data access must reject all unscoped queries.

## Non-destructive migration plan (NOT EXECUTED)

0. Gate: finish threat model, code review, least-privilege app-role
   provisioning, check Prisma 7 and adapter versions on a staging clone.
   Take and verify independent backups and a real restore drill BEFORE
   any customer-data copy, cutover or planned production migration.
1. Inventory current SQLite schema, exact row counts and foreign-key links
   for Product, Sale/SaleItem, StockMovement, CashShift, InventoryReceipt,
   PurchaseOrder, SaleReturn, StaffUser and audits. Record integrity checks
   and checksum of the original SQLite file; freeze no financial traffic
   without an explicit approved cutover window.
2. Provision NEW empty isolated PostgreSQL development and staging databases;
   never overwrite the existing SQLite DATABASE_URL. Configure separate
   migrate-owner and restricted application roles. Review migrations as SQL
   and apply only to new empty databases. Keep direct migration URL separate
   from pooled runtime URL. Do not use prisma db push for production.
3. Map legacy single-store records to a separately approved tenant, branch
   and register. Preserve IDs or store a durable old-id -> new-id mapping.
   Reconcile sale totals, stock opening balances/movements, returns, cash
   shifts, purchase receipts and costs. Never import passwords/hash formats
   without security review. Historical sales/returns must remain immutable.
   Build an idempotent, resumable dry-run importer and audit every rejected
   row. This importer is NOT part of M26.
4. Introduce session provider, multi-tenant membership resolver,
   server-side DAL + tx-scoped RLS, same-tenant FK validation on ALL
   endpoints and queries. Complete API, reports, exports, cache and worker
   hostile-ID tests and a real PostgreSQL connection-pool stress test.
   Do not launch with partially migrated/unscoped endpoints.
5. On isolated staging clone, compare row counts, totals, sequential
   receipts, stock valuation, refunds, tender and shift recon; rehearse
   load, backup restore and rollback. Validate physical scanner/receipt.
6. Only after two-tenant QA gates pass, plan a separate approved release:
   read-only legacy freeze, final delta copy/reconciliation, cutover,
   monitored pilot and documented rollback. Do not silently blend SQLite
   and PostgreSQL writers for the same sale or stock.

## Rollback strategy and tests

- This PR never executes live migrations. The dedicated GitHub Actions
  PostgreSQL service runs migration SQL INSIDE an open transaction and
  ROLLBACK; the test verifies no new schema or role persists afterward.
- SQL integration tests exercise a non-BYPASSRLS app role, missing context,
  tenant A/B reads and writes, cross-tenant FK attack and rollback of
  sale+ledger together. Unit tests cover revoked membership, cashier role,
  forged IDs and assignment checks.
- If a future staging validation fails, stop writers on the new staging
  database; discard and restore THAT isolated database from snapshot.
  Legacy SQLite remains untouched. In production, do NOT blindly reverse
  financial ledger or DROP tables; perform a reviewed, lossless recovery
  using validated backups, outbox and source-of-truth reconciliation.
- CI green is only evidence for the specific unit/SQL tests. It is not
  evidence of real pool isolation, Prisma7 generate, or working live auth.
  No paid SaaS tenants should be onboarded from this feature branch.

## Release blockers / next tickets

F00-03 / F00-06: pin Prisma7 + @prisma/adapter-pg and generate a working
runtime client in a separate build; migration diff review.
F01: live identity provider, sessions, MFA and platform separation.
F02: persist branch/register user assignment and expose verified tenant
selection; wire every route/service to tenant-aware DAL and RLS TX wrapper;
test request forged IDs and pooled connection reuse against real PostgreSQL.
F03-F06: migrate complete financial/inventory/purchase/refund models with
strict tenant composite FKs, concurrency and idempotent copy, then staged
rollout. Existing SQLite routes are NOT safely multi-tenant.
