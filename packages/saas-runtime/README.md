# M28 — revocable database sessions for the isolated SaaS runtime

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

- Prefer `readSessionToken` to resolve a stored opaque session and ACTIVE account
  inside the same guarded transaction, before tenant/membership checks. The
  alternate `resolveSession` contract remains for independently verified identity
  providers and tests. Exactly one session source is required; neither may trust
  actor IDs from request parameters. This package is not a login provider.
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
maintained login provider and cookie adapter, full sale/refund/shift/purchase schema and DAL, tenant
status rules, migration reconciliation/import dry run, backup restore and
application/hardware acceptance. M27 does not make the live POS multi-tenant.

References: https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql
and https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference

## M28 session verification and rollout contract

`readSessionToken` must read the dedicated `__Host-forma_saas_session` cookie from
**the current server request on each call**. Do not capture a user's token in a
module singleton. Use the exported secure/HttpOnly/SameSite=Lax/Path=/ cookie
options over HTTPS, with no Domain attribute. Never accept user/role/tenant claims
from that cookie. Missing, malformed, unknown, expired, revoked or disabled-account
sessions fail closed; missing membership is still forbidden after authentication.
Legacy demo/staff cookies are intentionally not accepted by this path.

`createSessionCredential` generates a random 256-bit token and SHA-256 digest.
Only its digest belongs in `app_session`; return the token only as the secure
cookie after successful login. Session lifetime is capped at eight hours by SQL.
The resolver uses database time and never caches identity. Every request rechecks
session, account and membership/assignments. Already-running transactions are not
cancelled by concurrent revocation; stronger revocation locking is a future gate.

Migration 000003 adds `app_session` and enables FORCE RLS on the global `app_user`
table. A runtime role needs SELECT on these two tables, in addition to M27 grants.
No session/account writes are granted to it. Without the transaction-local hash,
no identity rows are visible; with it, only the presented valid session and its
ACTIVE user are visible. The hash is sensitive internal context: never return it
from a DAL or log it. Trusted SQL and DB credentials remain a security boundary.

A separate, reviewed identity service must provision sessions after verified login,
revoke on logout/password reset, revoke all sessions atomically when disabling an
account (so re-enable cannot resurrect old sessions), and rotate after login or
privilege elevation. Its narrowly scoped DB provisioning grants are **not** added
here. The legacy POS cannot safely serve as this SaaS identity issuer. Auth.js or
another maintained provider still needs selection/integration, cookie transport,
CSRF/origin checks, throttling, audit, idle timeout, MFA/recovery and browser tests.
There is no public login/logout endpoint or route cutover in M28.

Validation includes real restricted-role PostgreSQL tests for opaque token lookup,
wrong user, forged token, hash replay, expiry, revocation, disabled account, identity
RLS, denied session creation, pooled context cleanup and maximum lifetime. The
SQL rollback suite includes the session migration. Rollback stops using the opt-in
runtime and leaves stored sessions/tables and protective RLS intact; it does not
run DROP or disable RLS. No live migration was executed.

Security reference: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html


## M29 draft — trusted identity lifecycle boundary

The optional `identity-lifecycle.ts` module defines a **server-only application contract** to issue sessions after a fresh external OIDC or passkey verification assertion (no older than five minutes) and to revoke one/all session digests. It generates a new random opaque token and sends **only its hash** to a caller-supplied isolated writer; it never returns a token after writer failure. Unit tests cover validation, expiry, storage failure and revocation.

**Not a live login service:** the module cannot independently verify an OIDC ID token/passkey, confirm account active status, prevent forged `VerifiedIdentity` assertions, perform session rotation or atomic account disable/revocation. The caller must enforce these protections and provide a DB-backed writer isolated from the restricted tenant runtime role. The session write contract is NOT exposed to clients, routes, or existing SQLite login. Add a hardened verified provider, scoped identity database permissions, transactional SQL, and PostgreSQL integration tests before issuing live credentials. Do not deploy or migrate merchant data.

## M30 request-security contract — draft implementation

`request-security.ts` is a server-only helper for future SaaS HTTP routes, not imported by the current SQLite demo login. It serializes strict Secure+HttpOnly+SameSite=Lax __Host- session cookies and an expired logout cookie. A per-session HMAC CSRF token binds a random nonce to the hash of the session credential using an independently configured, server-only secret. Strict Origin equality, same-origin Fetch Metadata (when sent), supported mutation method and the custom CSRF header are required. Missing Origin always fails closed.

**NOT a login system:** The verifier of OIDC/passkeys and server identity assertion is still absent. Neither this module nor the previously merged DB writer verifies users. Future routes must call PostgreSQL revocation/membership checks and issue the CSRF token only after independently verified login. Never accept identity claims, tokens, role, or CSRF secret from request bodies, or use NEXT_PUBLIC_ env variables. HTTPS origin config must match the actual deployment exactly, with trusted proxy handling reviewed. Secrets should have appropriate entropy and rotation planning; CSRF does not replace authentication or rate limiting. No route cutover or migrations occur in this PR.

Related: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html



## M30 provider identity atomicity (Draft)

The opt-in 000005 SQL introduces issuer/client/subject links and SECURITY DEFINER atomic issue/unlink functions. Both use account-row locking before link-row locking; unlink revokes all user sessions. No PUBLIC grants, schema cutover, account linking endpoint or live provider login. Functions must be reviewed with PostgreSQL role/ownership and adversarial concurrent transaction tests before permissions or production use.


## M30-06 provider identity PostgreSQL integration (Draft)

CI now applies opt-in migration 000005 to the **disposable local PostgreSQL** integration database. A dedicated login writer role receives only the provider session issuance function; a separate privileged identity admin role receives only the unlink function. Neither role is granted direct provider link table reads. Tests cover linked/unknown/revoked/disabled identities, denied tenant role invocations and concurrent issue/unlink operations that must leave zero unrevoked sessions. This test suite is NOT a production login, and no migrations have been run against merchant databases. Function ownership, permission provisioning, provider signature verification, account provisioning/reassignment, browser routes, CSRF and end-to-end QA remain review gates.
