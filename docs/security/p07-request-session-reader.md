# P07 — Request-scoped SaaS session cookie reader (24 Oct 2026)

Source: https://app.notion.com/p/401eb6880047814ca2c3d69eb34b37e2

## Implementation
- Opt-in, server-only strict parser for the exact `__Host-forma_saas_session` value.
- Reject malformed values, duplicate exact cookie names (shadowing), controls and excessive header size.
- A per-request closure rereads the current request headers instead of caching credentials across users/requests.
- Shared parser with opt-in SaaS logout to avoid inconsistent authentication and revocation interpretations.
- Missing credentials resolve to `undefined`; the existing tenant runtime performs PostgreSQL hash/session/role verification. Cookie parsing is never authentication by itself.

## Acceptance gates
- Unit tests for exact cookie, similarly named legacy/demo cookies, forged/duplicate/encoded values and concurrent request isolation.
- CI must pass SaaS runtime and root POS checks before review.
- Future route integration must create a new reader inside each request handler; never bind at module/global scope.
- Production identity provider, CSRF/proxy scrutiny, browser tests, database privilege review, and real tenant route cutover remain blocked.

No migrations, deployment, merchant data writes, or changes to current SQLite POS login.
