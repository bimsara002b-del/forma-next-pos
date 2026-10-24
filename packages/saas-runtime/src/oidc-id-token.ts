import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";

/** Pinned trusted JWKS, never derived from request or JWT jku/jwk headers. */
export type TrustedOidcConfig = { issuer: string; clientId: string; jwks: JSONWebKeySet };
export type VerifiedProviderSubject = {
  issuer: string; subject: string; clientId: string; verifiedAt: Date;
};
const kidFormat = /^[A-Za-z0-9._~:-]{1,128}$/;

/** Server-only signature and claims verification, NOT a POS login or user mapping. */
export async function verifyOidcIdToken(
  token: string, expectedNonce: string, settings: TrustedOidcConfig, now = new Date()
): Promise<VerifiedProviderSubject> {
  if ("window" in globalThis) throw Error("SERVER_ONLY_RUNTIME");
  if (typeof token !== "string" || token.length > 8192 ||
      !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2}$/.test(token))
    throw Error("INVALID_ID_TOKEN");
  if (!/^[A-Za-z0-9_-]{43}$/.test(expectedNonce) ||
      !Number.isFinite(now.getTime())) throw Error("INVALID_VERIFICATION_CONTEXT");
  let issuer: URL;
  try { issuer = new URL(settings.issuer); } catch { throw Error("INVALID_OIDC_SETTINGS"); }
  if (issuer.protocol !== "https:" || issuer.username || issuer.password ||
      issuer.search || issuer.hash || issuer.href !== settings.issuer ||
      !settings.clientId || settings.clientId.length > 256 ||
      /[\s\x00-\x1f]/.test(settings.clientId)) throw Error("INVALID_OIDC_SETTINGS");
  if (!settings.jwks || !Array.isArray(settings.jwks.keys) ||
      settings.jwks.keys.length < 1 || settings.jwks.keys.length > 20)
    throw Error("UNTRUSTED_JWKS");
  const keyIds = new Set<string>();
  for (const key of settings.jwks.keys) {
    if (key.kty !== "RSA" || !key.n || !key.e || !kidFormat.test(key.kid ?? "") ||
        (key.alg !== undefined && key.alg !== "RS256") ||
        (key.use !== undefined && key.use !== "sig") ||
        (key.key_ops !== undefined && (!Array.isArray(key.key_ops) || !key.key_ops.includes("verify"))) ||
        ["d","p","q","dp","dq","qi","oth","k"].some(prop => prop in key) ||
        keyIds.has(key.kid!)) throw Error("UNTRUSTED_JWKS");
    keyIds.add(key.kid!);
  }
  try {
    const { payload, protectedHeader } = await jwtVerify(
      token, createLocalJWKSet(settings.jwks), {
        issuer: settings.issuer, audience: settings.clientId, algorithms: ["RS256"],
        maxTokenAge: "5m", clockTolerance: "5s", currentDate: now
      }
    );
    if (protectedHeader.alg !== "RS256" || !keyIds.has(protectedHeader.kid ?? "") ||
        protectedHeader.jwk !== undefined || protectedHeader.jku !== undefined ||
        protectedHeader.x5u !== undefined || protectedHeader.crit !== undefined ||
        !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
        typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255 ||
        [...payload.sub].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
        payload.nonce !== expectedNonce ||
        (payload.azp !== undefined && payload.azp !== settings.clientId) ||
        (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== settings.clientId))
      throw Error("INVALID_CLAIMS");
    return { issuer: settings.issuer, subject: payload.sub,
      clientId: settings.clientId, verifiedAt: new Date(now.getTime()) };
  } catch {
    throw Error("OIDC_ID_TOKEN_REJECTED");
  }
}
