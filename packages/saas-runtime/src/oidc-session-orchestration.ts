import { verifyBrowserOidcCallback } from "./oidc-browser-verification";
import type { OidcConfig, FlowStore } from "./oidc-pkce-flow";
import type { TrustedOidcConfig } from "./oidc-id-token";
import type { IdentitySessionWriter } from "./identity-db-writer";
import { clearOidcBrowserCookie } from "./oidc-browser-binding";
import { createSessionCredential, SAAS_SESSION_MAX_AGE } from "./session";
import { sessionCookie } from "./request-security";

type TokenTransport = (url: string, init: RequestInit) => Promise<Response>;

// Private, opt-in composition. Do not import into a live HTTP route before
// independent provider, proxy, account, CSRF and browser security reviews.
export async function completeVerifiedOidcLogin(
  config: OidcConfig,
  trustedKeys: TrustedOidcConfig,
  flows: FlowStore,
  identityWriter: Pick<IdentitySessionWriter, "issueProviderSession">,
  query: URLSearchParams,
  cookieHeader: string | null,
  options: { now?: Date; transport?: TokenTransport } = {}
): Promise<
  | { ok: true; setCookieHeaders: readonly [string, string]; expiresAt: Date }
  | { ok: false; reason: "OIDC_LOGIN_REJECTED"; setCookieHeaders: readonly [string] }
> {
  if ("window" in globalThis) throw Error("SERVER_ONLY_RUNTIME");
  const reject = () => ({
    ok: false as const,
    reason: "OIDC_LOGIN_REJECTED" as const,
    setCookieHeaders: [clearOidcBrowserCookie()] as const
  });

  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) return reject();

  try {
    const result = await verifyBrowserOidcCallback(
      config, trustedKeys, flows, query, cookieHeader, options
    );
    if (!result.ok) return reject();
    const credential = createSessionCredential();
    const expiresAt = new Date(now.getTime() + SAAS_SESSION_MAX_AGE * 1000);
    const cookie = sessionCookie(credential.token);
    // Privileged SQL function must check exact issuer/client/subject, active
    // account/link, and persist the hash atomically under the account row lock.
    await identityWriter.issueProviderSession({
      issuer: result.identity.issuer,
      clientId: result.identity.clientId,
      subject: result.identity.subject,
      tokenHash: credential.tokenHash,
      createdAt: now,
      expiresAt
    });
    // Raw token is only exposed inside a Secure, HttpOnly cookie instruction,
    // never in the JSON response body or any database write.
    return {
      ok: true as const,
      setCookieHeaders: [result.clearCookie, cookie] as const,
      expiresAt
    };
  } catch {
    // Fail closed, including identity writer failures; no session cookie
    // returned. Keep all provider details and credentials out of errors.
    return reject();
  }
}
