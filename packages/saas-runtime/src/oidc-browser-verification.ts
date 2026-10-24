import { consumeBrowserOidc } from "./oidc-browser-callback";
import type { OidcConfig, FlowStore } from "./oidc-pkce-flow";
import { exchangeVerifiedOidcCode } from "./oidc-token-exchange";
import type { TrustedOidcConfig, VerifiedProviderSubject } from "./oidc-id-token";

type TokenTransport = (endpoint: string, init: RequestInit) => Promise<Response>;

/** Optional server-side OIDC callback verification, not a live login endpoint.
 * The account/session provisioning boundary remains a separately reviewed step.
 */
export async function verifyBrowserOidcCallback(
  config: OidcConfig,
  trustedKeys: TrustedOidcConfig,
  store: FlowStore,
  query: URLSearchParams,
  cookieHeader: string | null,
  options: { transport?: TokenTransport; now?: Date } = {}
): Promise<
  | { ok: true; identity: VerifiedProviderSubject; clearCookie: string }
  | { ok: false; reason: "OIDC_CALLBACK_REJECTED"; clearCookie: string }
> {
  if ("window" in globalThis) throw Error("SERVER_ONLY_RUNTIME");
  const now = options.now ?? new Date();
  const callback = await consumeBrowserOidc(config, store, query, cookieHeader, now.getTime());
  if (!callback.ok) {
    return { ok: false, reason: "OIDC_CALLBACK_REJECTED", clearCookie: callback.clearCookie };
  }
  try {
    const identity = await exchangeVerifiedOidcCode(callback.exchange, config, trustedKeys, {
      transport: options.transport, now
    });
    return { ok: true, identity, clearCookie: callback.clearCookie };
  } catch {
    return { ok: false, reason: "OIDC_CALLBACK_REJECTED", clearCookie: callback.clearCookie };
  }
}
