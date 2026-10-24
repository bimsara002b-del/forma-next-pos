# P04 — Browser-bound OIDC callback verification (24 October 2026)

Source: https://app.notion.com/p/401eb6880047814ca2c3d69eb34b37e2

## Scope
This is an **opt-in, server-only** composition of the existing browser cookie state binding, one-time durable PKCE state consumption, pinned token endpoint exchange and signed ID token verification. The result is a verified issuer/client/subject, not a session.

## Security invariants
- Browser cookie binding is checked before consuming state, so a swapped-browser callback cannot burn a valid flow.
- Durable flow consumes once; a replay fails before token exchange.
- The PKCE verifier and expected nonce come only from consumed state; not caller-supplied browser data.
- Provider network/token errors return one generic rejection with cookie clear instruction.
- Caller must use trusted flow store, verified OIDC configuration, and pre-pinned trusted keys. Never construct them from a request.
- No login endpoint, session cookie, user mapping, or privileges are enabled here.

## Acceptance
Unit tests should verify valid callback, replay, cross-browser swap, trusted nonce binding, rejection/redacted failures. CI must pass both SaaS and root POS workflows; manual security review and real provider integration remain open.

## Next production blockers
Trusted atomic provider session issuance and verified account mapping, SSR route integration with CSRF/origin, MFA, abuse throttling, session rotation, browser E2E, RLS/tenant DAL adoption, and recovery/pilot plan.

No database migration, deployment, merchant record changes, or legacy POS auth changes.
