import { verifyOidcIdToken, type TrustedOidcConfig, type VerifiedProviderSubject } from "./oidc-id-token";
import type { OidcConfig } from "./oidc-pkce-flow";

/** The output of consumeOidc/consumeBrowserOidc after an atomic state consume.
 * Only trusted server orchestration may provide it; no browser/route input
 * is accepted as a verified identity or authorization decision.
 */
export type ConsumedOidcCode = {
  code: string;
  codeVerifier: string;
  expectedNonce: string;
  issuer: string;
  clientId: string;
  tokenEndpoint: string;
  redirectUri: string;
};
type TokenTransport = (endpoint: string, init: RequestInit) => Promise<Response>;
const TOKEN_ERROR = "OIDC_TOKEN_EXCHANGE_REJECTED";
const CODE = /^[\x21-\x7e]{1,2048}$/;
const OPAQUE_43 = /^[A-Za-z0-9_-]{43}$/;

function validPinnedHttps(value: string): boolean {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) &&
      !url.username && !url.password && !url.search && !url.hash &&
      url.href === value;
  } catch { return false; }
}

async function readBoundedResponse(response: Response): Promise<Record<string, unknown>> {
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > 16384) throw Error(TOKEN_ERROR);
  const reader = response.body?.getReader();
  if (!reader) throw Error(TOKEN_ERROR);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 16384) {
        await reader.cancel();
        throw Error(TOKEN_ERROR);
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  const result: unknown = JSON.parse(raw);
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw Error(TOKEN_ERROR);
  return result as Record<string, unknown>;
}

/** Optional isolated M30 token exchange. This NEVER issues a session,
 * returns an access token or maps a provider account. The caller must have
 * atomically consumed a browser-bound PKCE state and use pinned server config.
 * Public-client PKCE only; confidential-client provider support requires a
 * separately reviewed credential-handling adapter.
 */
export async function exchangeVerifiedOidcCode(
  consumed: ConsumedOidcCode,
  config: OidcConfig,
  trustedKeys: TrustedOidcConfig,
  options: { transport?: TokenTransport; now?: Date } = {}
): Promise<VerifiedProviderSubject> {
  if ("window" in globalThis) throw Error("SERVER_ONLY_RUNTIME");
  try {
    if (!consumed || !config || !trustedKeys ||
        consumed.issuer !== config.issuer ||
        consumed.clientId !== config.clientId ||
        consumed.tokenEndpoint !== config.tokenEndpoint ||
        consumed.redirectUri !== config.redirectUri ||
        trustedKeys.issuer !== config.issuer ||
        trustedKeys.clientId !== config.clientId ||
        !validPinnedHttps(config.issuer) ||
        !validPinnedHttps(config.tokenEndpoint) ||
        !validPinnedHttps(config.redirectUri) ||
        !CODE.test(consumed.code) ||
        !OPAQUE_43.test(consumed.codeVerifier) ||
        !OPAQUE_43.test(consumed.expectedNonce) ||
        !config.clientId || config.clientId.length > 256 ||
        /[\s\x00-\x1f]/.test(config.clientId)) throw Error(TOKEN_ERROR);

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: consumed.code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      code_verifier: consumed.codeVerifier
    });
    const response = await (options.transport ?? fetch)(config.tokenEndpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "Cache-Control": "no-store"
      },
      body: form,
      redirect: "manual",
      credentials: "omit",
      signal: AbortSignal.timeout(5000)
    });
    if (response.status !== 200 ||
        response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
      throw Error(TOKEN_ERROR);
    const tokens = await readBoundedResponse(response);
    if (typeof tokens.id_token !== "string" ||
        tokens.id_token.length > 8192 ||
        typeof tokens.access_token !== "string" ||
        !tokens.access_token || tokens.access_token.length > 8192 ||
        typeof tokens.token_type !== "string" ||
        tokens.token_type.toLowerCase() !== "bearer") throw Error(TOKEN_ERROR);

    // Only the signed, pinned-key verified subject crosses this boundary.
    // Access/refresh tokens, client secrets and raw ID token never do.
    return await verifyOidcIdToken(
      tokens.id_token, consumed.expectedNonce, trustedKeys, options.now ?? new Date()
    );
  } catch {
    // Never expose OAuth code, PKCE verifier, provider error, or token content.
    throw Error(TOKEN_ERROR);
  }
}
