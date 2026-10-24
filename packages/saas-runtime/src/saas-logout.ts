import type { SessionWriter } from "./identity-lifecycle";
import { hashSessionToken } from "./session";
import { readSaasSessionCookie } from "./saas-request-session";
import { expiredSessionCookie, verifySaasMutationRequest } from "./request-security";

type LogoutRequest = { method: string; headers: Pick<Headers, "get"> };
type RevocationWriter = Pick<SessionWriter, "revokeHash">;
const LOGOUT_ERROR = "SAAS_LOGOUT_REJECTED";

/** Read precisely one host-bound session credential from the current request.
 * Reject cookie shadowing (including repeated same-name cookies) and malformed
 * credentials; neither user IDs nor hashes supplied by the browser are trusted.
 */
export const readLogoutSessionCookie = readSaasSessionCookie;

/** Opt-in M30 logout boundary; NOT an active Next.js route.
 * The caller must pass only trusted expectedOrigin/CSRF secret and a dedicated
 * identity-DB writer, never a tenant-runtime or browser-supplied writer.
 * No data mutation occurs until exact origin, CSRF, cookie and method validate.
 */
export async function revokeSaasLogout(
  request: LogoutRequest,
  expectedOrigin: string,
  csrfSecret: string,
  writer: RevocationWriter,
  now = new Date()
): Promise<
  | { ok: true; setCookie: string }
  | { ok: false; reason: typeof LOGOUT_ERROR }
> {
  if ("window" in globalThis) throw Error("SERVER_ONLY_RUNTIME");
  const denied = (): { ok: false; reason: typeof LOGOUT_ERROR } =>
    ({ ok: false, reason: LOGOUT_ERROR });

  try {
    if (!request || request.method !== "POST" ||
        !Number.isFinite(now.getTime())) return denied();
    const credential = readLogoutSessionCookie(request.headers.get("cookie"));
    if (!credential ||
        !verifySaasMutationRequest(request, expectedOrigin, credential, csrfSecret))
      return denied();
    const tokenHash = hashSessionToken(credential);
    if (!tokenHash) return denied();
    // Same narrowly permissioned SQL revocation function used by the M30
    // identity writer. A 0-row result means an already-revoked/unknown hash;
    // respond identically to avoid providing an account/session oracle.
    const count = await writer.revokeHash({ tokenHash, revokedAt: now });
    if (!Number.isSafeInteger(count) || count < 0) return denied();
    // Never clear a browser credential before a successful DB round trip.
    return { ok: true, setCookie: expiredSessionCookie() };
  } catch {
    // Do not disclose session hash, raw cookie, CSRF token or database errors.
    return denied();
  }
}
