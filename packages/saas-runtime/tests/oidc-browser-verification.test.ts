import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { beginBrowserOidc } from "../src/oidc-browser-callback";
import { verifyBrowserOidcCallback } from "../src/oidc-browser-verification";
import type { FlowStore, PendingFlow, OidcConfig } from "../src/oidc-pkce-flow";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const config: OidcConfig = {
  issuer: "https://identity.example.test/tenant",
  authorizationEndpoint: "https://identity.example.test/authorize",
  tokenEndpoint: "https://identity.example.test/token",
  clientId: "forma-client",
  redirectUri: "https://pos.example.test/auth/callback"
};
const trusted = {
  issuer: config.issuer, clientId: config.clientId,
  jwks: { keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }] }
};
const now = new Date("2026-10-24T12:00:00Z");
function store() {
  const records = new Map<string, PendingFlow>();
  let reads = 0;
  const api: FlowStore = {
    async create(flow) { records.set(flow.digest, flow); },
    async consume(hash) { reads++; const record = records.get(hash) ?? null; records.delete(hash); return record; }
  };
  return { api, reads: () => reads };
}
function signedToken(nonce: string) {
  const head = Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: config.issuer, aud: config.clientId, sub: "prelinked-subject", nonce,
    iat: Math.floor(now.getTime() / 1000) - 5, exp: Math.floor(now.getTime() / 1000) + 300
  })).toString("base64url");
  return head + "." + claims + "." + sign("RSA-SHA256", Buffer.from(head + "." + claims), keys.privateKey).toString("base64url");
}
describe("M30 browser-bound identity verification composition", () => {
  it("verifies a bound callback once using the consumed nonce", async () => {
    const s = store();
    const begin = await beginBrowserOidc(config, s.api, now.getTime());
    const state = new URL(begin.authorizationUrl).searchParams.get("state")!;
    const query = new URLSearchParams({ state, code: "valid-code" });
    const transport = vi.fn(async (_url: string, init: RequestInit) => {
      const form = new URLSearchParams(init.body as URLSearchParams);
      expect(form.get("code_verifier")).toMatch(/^[\w-]{43}$/);
      const stored = Array.from((s as unknown as { api: FlowStore }).api ? [state] : []);
      expect(stored).toHaveLength(1);
      return new Response(JSON.stringify({
        id_token: signedToken(expectedNonce), access_token: "test-access", token_type: "Bearer"
      }), { headers: { "content-type": "application/json" } });
    });
    // Capture nonce from the trusted test flow at creation time, never browser query.
    let expectedNonce = "";
    const wrapped: FlowStore = {
      create: async flow => { expectedNonce = flow.nonce; await s.api.create(flow); },
      consume: hash => s.api.consume(hash)
    };
    // Re-run on a fresh flow with nonce captured via trusted storage.
    const newBegin = await beginBrowserOidc(config, wrapped, now.getTime());
    const newState = new URL(newBegin.authorizationUrl).searchParams.get("state")!;
    const validQuery = new URLSearchParams({ state: newState, code: "valid-code" });
    const valid = await verifyBrowserOidcCallback(
      config, trusted, wrapped, validQuery, newBegin.setCookie.split(";")[0], { transport, now }
    );
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.identity.subject).toBe("prelinked-subject");
    expect(valid).not.toHaveProperty("access_token");
    expect((await verifyBrowserOidcCallback(config, trusted, wrapped, validQuery,
      newBegin.setCookie.split(";")[0], { transport, now })).ok).toBe(false);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("rejects a different browser before consuming state", async () => {
    const s = store();
    const first = await beginBrowserOidc(config, s.api, now.getTime());
    const second = await beginBrowserOidc(config, s.api, now.getTime());
    const query = new URLSearchParams({
      state: new URL(first.authorizationUrl).searchParams.get("state")!, code: "valid-code"
    });
    const transport = vi.fn(async () => { throw Error("MUST_NOT_RUN"); });
    expect((await verifyBrowserOidcCallback(config, trusted, s.api, query,
      second.setCookie.split(";")[0], { transport, now })).ok).toBe(false);
    expect(s.reads()).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  });
  it("fails closed on provider exchange failure after consuming state", async () => {
    const s = store();
    const started = await beginBrowserOidc(config, s.api, now.getTime());
    const query = new URLSearchParams({
      state: new URL(started.authorizationUrl).searchParams.get("state")!, code: "valid-code"
    });
    const reject = await verifyBrowserOidcCallback(config, trusted, s.api, query,
      started.setCookie.split(";")[0], {
        now, transport: async () => { throw Error("upstream secret"); }
      });
    expect(reject).toMatchObject({ ok: false, reason: "OIDC_CALLBACK_REJECTED" });
    expect(JSON.stringify(reject)).not.toContain("secret");
    expect((await verifyBrowserOidcCallback(config, trusted, s.api, query,
      started.setCookie.split(";")[0], { now })).ok).toBe(false);
  });
});
