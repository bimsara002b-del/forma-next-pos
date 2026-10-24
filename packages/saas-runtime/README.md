# M27 — isolated Prisma 7 PostgreSQL runtime

This private server package validates/generates the SaaS schema with pinned Prisma
7.10.1 and adapter-pg, without replacing root Prisma 6 or the SQLite POS runtime.
It is not imported by any live Next.js route. No merchant database migration or
production rollout is included.

From repository root:

```sh
npm ci --prefix packages/saas-runtime
npm run validate --prefix packages/saas-runtime
npm run generate --prefix packages/saas-runtime
npm run typecheck --prefix packages/saas-runtime
npm test --prefix packages/saas-runtime
```

The last command runs configuration tests and skips database tests unless BOTH
SAAS_TEST_ADMIN_URL and SAAS_TEST_APP_URL are explicitly set. CI supplies a fresh
PostgreSQL 16 service named forma_saas_runtime_test on loopback. Tests reject
existing forma_saas schemas and never drop/clear them. They provision synthetic
fixtures and a restricted login; CI discards the service after the job.

## Security contract

- Supply a server-owned resolveSession callback that authenticates the user and
  checks account/session revocation on every call. It must never trust actor IDs
  from request parameters. This package does not implement that login provider.
- withTenant sets transaction-local RLS context ONLY to bootstrap membership
  lookup, then reloads membership/branch/register assignments and applies M26
  authorization before invoking trusted DAL code. The GUC is not authentication.
- The callback must use/await only the provided transaction and apply the returned
  branch scope on branch-owned queries. Tenant RLS is not branch RLS. No raw client
  is returned. Do not expose callbacks or arbitrary queries to browsers.
- Migration owner, superuser, BYPASSRLS and inherited table-owner roles fail
  closed, as does a pooled connection retaining tenant context.
- PostgreSQL connection settings are explicit; never fall back to DATABASE_URL.
  SAAS_DIRECT_DATABASE_URL is only for Prisma CLI; runtime connectionString is
  supplied separately with restricted credentials. TLS is not disabled.
- Session checks and membership checks occur per transaction; immediate revocation
  of an already-running transaction requires a later revocation/locking policy.
- listProducts is a bounded internal catalog example (first 100), returns BigInt
  price values and requires a transport DTO before HTTP use. No cost data included.

## Schema and release boundaries

The additive 000002 migration persists member_branch and member_register with
composite same-tenant/same-branch foreign keys and FORCE RLS. The 000001 baseline
is unchanged. Do not use db push to overwrite hand-written constraints/RLS.
CI tests apply migrations only to the new empty service database.

Rollback for this opt-in package is to stop importing it/revert the app change;
leave assignment tables/data intact. No destructive down migration is provided.
The existing SQLite database is unaffected. Before any cutover, implement the
real session resolver, full sale/refund/shift/purchase schema and DAL, tenant
status rules, migration reconciliation/import dry run, backup restore and
application/hardware acceptance. M27 does not make the live POS multi-tenant.

References: https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql
and https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference
