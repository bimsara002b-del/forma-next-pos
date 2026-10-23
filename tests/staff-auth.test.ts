import { describe, expect, it } from "vitest";
import { hashPassword, matchesPassword, hasPermission, newStaffSession, verifyStaffSession } from "../src/lib/staff";
const secret = "test-session-key-is-long-enough-01234567890";
describe("local role permissions and staff sessions", () => {
  it("enforces roles", () => {
    expect(hasPermission("OWNER", "staff.manage")).toBe(true);
    expect(hasPermission("MANAGER", "staff.manage")).toBe(false);
    expect(hasPermission("MANAGER", "stock.manage")).toBe(true);
    expect(hasPermission("CASHIER", "stock.manage")).toBe(false);
    expect(hasPermission("CASHIER", "checkout")).toBe(true);
  });
  it("hashes and verifies passwords with unique salts", async () => {
    const a = await hashPassword("local-staff-password");
    const b = await hashPassword("local-staff-password");
    expect(a).not.toEqual(b);
    expect(await matchesPassword("local-staff-password", a)).toBe(true);
    expect(await matchesPassword("incorrect-password", a)).toBe(false);
    await expect(hashPassword("short")).rejects.toThrow();
  });
  it("rejects tampered and expired signed sessions", () => {
    const token = newStaffSession("user_123", 2, secret);
    expect(verifyStaffSession(token, secret)).toEqual({id:"user_123", version:2});
    expect(verifyStaffSession(token.replace("user_123","user_456"), secret)).toBeNull();
    expect(verifyStaffSession(token, "different-secret-is-at-least-thirtytwo-characters")).toBeNull();
    expect(verifyStaffSession(token, secret, Math.floor(Date.now()/1000)+9*3600)).toBeNull();
  });
});
