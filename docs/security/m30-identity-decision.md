# M30 security decision record — proposed, requires review

## Boundary
- Use a maintained OIDC Authorization Code + PKCE provider (Auth.js is a candidate, not selected or integrated); validate issuer, audience, signature, nonce, state, expiry and replay server-side.
- Never accept a browser-supplied user ID, role or VerifiedIdentity as proof. Only a trusted server verifier may invoke session issuance.
- The isolated PostgreSQL identity service uses a dedicated least-privileged database connection, separate from tenant-runtime credentials. Migration 000004 creates narrowly scoped SECURITY DEFINER functions with a pinned search path and no public EXECUTE grants.
- No table mutation grants for the identity login; provision explicit EXECUTE for only four named functions to that role, never to tenant runtime.
- Session issuance, revoke-all and disabling an account lock the same app_user row. Account disable and all-session revocation are one database transaction; re-enable must not resurrect old sessions. Token hashes only are stored, no raw credential logs.
- Session cookie __Host-forma_saas_session remains Secure, HttpOnly, SameSite=Lax, Path=/, eight-hour maximum; HTTP cookie/CSRF and verified login adapters are **not** implemented here.

## Threats and release gates
1. Reject forged, expired, wrong issuer/audience or replayed OIDC assertions before issuing session.
2. Reject disabled accounts, race issue vs disable/revoke-all; test atomicity and rollback against disposable PostgreSQL.
3. Verify the tenant-runtime role cannot call identity functions, read all identities or insert sessions; reject migration-owner credentials.
4. Keep real HTTP login/logout routes, MFA/recovery, rate limiting and SaaS cutover disabled until independently reviewed provider verification, secrets provisioning, tests and deployment plan exist.
5. Physical devices, merchant data and legacy Laravel POS are out of scope.

Status: M30-01 proposed architecture and M30-03 implementation slice only. Not approved for production.
