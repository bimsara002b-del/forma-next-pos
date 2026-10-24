import { expect, it } from "vitest";
import { createSessionCredential, hashSessionToken, SAAS_SESSION_COOKIE, SAAS_SESSION_COOKIE_OPTIONS } from "../src/session";
it("creates opaque random credentials and stores only a one-way digest",()=>{
 const a=createSessionCredential(), b=createSessionCredential();
 expect(a.token).toMatch(/^[0-9a-f]{64}$/);
 expect(a.token).not.toBe(b.token);
 expect(a.tokenHash).toBe(hashSessionToken(a.token));
 expect(a.tokenHash).not.toBe(a.token);
});
it.each([undefined,"","x".repeat(64),"a".repeat(63),"a".repeat(65),"A".repeat(64)," a".repeat(32)])(
 "rejects invalid cookie format %s", token=>expect(hashSessionToken(token)).toBeNull());
it("uses a separate HTTPS host-only HttpOnly cookie",()=>{
 expect(SAAS_SESSION_COOKIE).toBe("__Host-forma_saas_session");
 expect(SAAS_SESSION_COOKIE_OPTIONS).toEqual({secure:true,httpOnly:true,sameSite:"lax",path:"/",maxAge:28800});
});
