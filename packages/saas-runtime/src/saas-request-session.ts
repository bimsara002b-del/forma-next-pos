import { SAAS_SESSION_COOKIE, type SessionTokenReader } from "./session";

export type SaasCookieRequest = {
  headers: Pick<Headers, "get">;
};

const TOKEN = /^[0-9a-f]{64}$/;

/** The __Host- cookie is opaque; do not URI-decode, strip quotes, or accept
 * similarly named demo/staff/Bearer credentials. Reject duplicate exact names
 * (cookie shadowing) even if the two values are identical.
 */
export function readSaasSessionCookie(header: string | null): string | null {
  if (typeof header !== "string" || header.length === 0 ||
      header.length > 8192 || /[\r\n\x00-\x1f\x7f]/.test(header)) return null;
  const pairs = header.split(";");
  if (pairs.length > 128) return null;
  let found: string | null = null;
  for (const pair of pairs) {
    const field = pair.trim();
    const equalAt = field.indexOf("=");
    if (equalAt < 0) continue;
    const name = field.slice(0, equalAt).trim();
    if (name !== SAAS_SESSION_COOKIE) continue;
    // A repeated name is ambiguous regardless of value.
    if (found !== null) return null;
    const value = field.slice(equalAt + 1);
    if (!TOKEN.test(value)) return null;
    found = value;
  }
  return found;
}

/** Create separately inside each trusted server request, never at module scope.
 * Reads that request's Cookie header on each invocation and returns undefined
 * to the tenant DAL for any missing, forged or ambiguous credential. The DAL
 * still checks session hash, expiry, revocation, ACTIVE account and membership
 * against PostgreSQL; parsing a cookie alone does not authenticate anyone.
 */
export function createSaasRequestSessionReader(request: SaasCookieRequest): SessionTokenReader {
  if ("window" in globalThis) throw Error("SERVER_ONLY_RUNTIME");
  if (!request?.headers || typeof request.headers.get !== "function")
    throw Error("INVALID_SAAS_REQUEST");
  return async () => {
    try {
      return readSaasSessionCookie(request.headers.get("cookie")) ?? undefined;
    } catch {
      // Malformed/unsupported request headers fail closed.
      return undefined;
    }
  };
}
