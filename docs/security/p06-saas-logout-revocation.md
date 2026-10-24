# P06 — M30 Secure SaaS Logout (24 October 2026)

Source: https://app.notion.com/p/401eb6880047814ca2c3d69eb34b37e2

## Implemented code (opt-in only)
- Read a single exact `__Host-forma_saas_session` cookie from the current request; reject duplicates and malformed tokens.
- Require POST, exact trusted HTTPS Origin, same-origin Fetch Metadata if supplied, and HMAC CSRF token bound to the presented session.
- Derive SHA-256 session digest server-side and invoke the dedicated identity-writer revocation operation; expire browser cookie only after a successful DB roundtrip.
- Return generic errors and avoid leaking cookie, CSRF token, hash or database errors.
- A revoked/unknown hash returning zero rows receives the same successful response as a valid revocation, without an existence oracle.

## Tests
- Valid logout invokes hash-only revocation then expires cookie.
- GET/DELETE, cross-origin, invalid CSRF and cross-site requests cannot revoke.
- Duplicate/malformed/missing cookies cannot revoke.
- Writer failure never clears cookie; zero-row outcome is indistinguishable.
- No active Next.js HTTP route is wired to this helper.

## Release blockers
Review reverse proxy / origin handling, DB revocation semantics, browser cookie behavior, concurrency and distributed throttling. Browser E2E and actual identity integration are still missing. Keep existing SQLite demo auth intact.

## Safety
No migrations, deployments, production identity/session writes or merchant data touched. CI and security review required before merging.
