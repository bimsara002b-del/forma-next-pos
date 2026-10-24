import { describe, expect, it, vi } from "vitest";
import { createSessionCredential, hashSessionToken, SAAS_SESSION_COOKIE } from "../src/session";
import { mintSessionCsrf } from "../src/request-security";
import { readLogoutSessionCookie, revokeSaasLogout } from "../src/saas-logout";

const token = createSessionCredential().token;
const origin = "https://pos.example.test";
const secret = "test-secret-with-at-least-thirty-two-characters";
const csrf = mintSessionCsrf(token, secret);
const now = new Date("2026-10-24T12:00:00Z");
function request(overrides: Record<string, string> = {}, method = "POST") {
 const headers = new Headers({
  cookie: SAAS_SESSION_COOKIE + "=" + token,
  origin, "sec-fetch-site": "same-origin", "x-forma-csrf": csrf,
  ...overrides
 });
 return { method, headers };
}
function writer(count = 1) {
 return { revokeHash: vi.fn(async () => count) };
}

describe("M30 isolated, CSRF-bound session logout", () => {
 it("hashes only the presented session and clears cookie after DB revocation", async () => {
  const db = writer();
  const result = await revokeSaasLogout(request(), origin, secret, db, now);
  expect(result).toMatchObject({ ok: true });
  if (result.ok) {
   expect(result.setCookie).toContain(SAAS_SESSION_COOKIE + "=;");
   expect(result.setCookie).toContain("Max-Age=0; Secure; HttpOnly; SameSite=Lax");
   expect(result.setCookie).not.toContain(token);
  }
  expect(db.revokeHash).toHaveBeenCalledWith({ tokenHash: hashSessionToken(token), revokedAt: now });
 });
 it("never revokes for invalid HTTP method, origin, CSRF, or fetch site", async () => {
  for (const r of [
   request({}, "GET"),
   request({}, "DELETE"),
   request({origin:"https://attacker.test"}),
   request({"x-forma-csrf":"invalid"}),
   request({"sec-fetch-site":"cross-site"})
  ]) {
   const db = writer();
   expect((await revokeSaasLogout(r, origin, secret, db, now)).ok).toBe(false);
   expect(db.revokeHash).not.toHaveBeenCalled();
  }
 });
 it("rejects missing, duplicate, and malformed cookies without revoking", async () => {
  for(const value of [
   "",
   SAAS_SESSION_COOKIE + "=" + token + "; " + SAAS_SESSION_COOKIE + "=" + token,
   SAAS_SESSION_COOKIE + "=invalid",
   "another_session=" + token
  ]) {
   const db = writer();
   expect((await revokeSaasLogout(request({cookie:value}),origin,secret,db,now)).ok).toBe(false);
   expect(db.revokeHash).not.toHaveBeenCalled();
  }
  expect(readLogoutSessionCookie(SAAS_SESSION_COOKIE + "=" + token)).toBe(token);
 });
 it("does not clear cookie if revocation fails", async () => {
  const db = { revokeHash: vi.fn(async () => { throw Error("PRIVATE_DB_ERROR"); }) };
  const result = await revokeSaasLogout(request(),origin,secret,db,now);
  expect(result).toEqual({ok:false,reason:"SAAS_LOGOUT_REJECTED"});
  expect(JSON.stringify(result)).not.toContain("PRIVATE_DB_ERROR");
 });
 it("returns uniform outcome for already-revoked sessions without exposing existence", async () => {
  const db = writer(0);
  expect((await revokeSaasLogout(request(),origin,secret,db,now)).ok).toBe(true);
 });
});
