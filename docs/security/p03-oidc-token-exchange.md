# Update 03 — M30 OIDC Token Endpoint Exchange (24 October 2026)

Source: https://app.notion.com/p/401eb6880047814ca2c3d69eb34b37e2

This **opt-in server-only** M30 increment takes the code-verifier, nonce and code from an already **atomically consumed, browser-bound** OIDC flow. It performs a bounded authorization-code exchange using a server-pinned HTTPS token endpoint, POST form and PKCE verifier, rejects redirects, malformed/oversized/non-JSON errors and mismatched config, and checks the resulting signed ID token using the existing pinned-JWKS verifier.

The function yields ONLY a verified provider subject; it does not expose access/refresh/ID tokens, link an account, issue a session or make any live authentication route available.

## Release gates still open
- Independently review callback orchestration and wire only a trusted flow-consume result, never browser supplied code/verifier fields.
- Provider-specific confidential client authentication, discovery/JWKS rotation and replay/rotation policy.
- Live provider integration, narrowly scoped account mapping and atomic session writer orchestration.
- CSRF/Origin, auth throttling, MFA, browser E2E, tenant-safe financial DAL, pilot QA and rollback/restore.
- Do not deploy or merge as complete SaaS authentication. No database migrations or production data mutation.

## Test expectations
- Validate successful PKCE form exchange and verified identity without leaking tokens.
- Deny configuration changes before outbound request.
- Deny redirect, provider error, invalid JSON/response, excessive response size, absent bearer token, signature/issuer/audience/nonce mismatch.
- CI must pass both root verify and isolated saas-runtime; a green CI is not browser/production signoff.
