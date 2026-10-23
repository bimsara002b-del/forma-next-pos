import { describe, expect, it } from "vitest";
import { MAX_FAILED_LOGINS, retryAfterSeconds, throttleKey } from "../src/lib/login-throttle";
describe("staff login throttle helpers",()=>{
  it("hashes normalized identity without exposing username",()=>{
    const key=throttleKey("Owner","unit-test-secret-01234567890123456789");
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).toBe(throttleKey("owner","unit-test-secret-01234567890123456789"));
    expect(key).not.toContain("owner");
  });
  it("sets countdown for locks and expires safely",()=>{
    const now=new Date("2026-10-23T00:00:00Z");
    expect(retryAfterSeconds(new Date(now.getTime()+2500),now)).toBe(3);
    expect(retryAfterSeconds(new Date(now.getTime()-1000),now)).toBe(0);
    expect(retryAfterSeconds(null,now)).toBe(0);
    expect(MAX_FAILED_LOGINS).toBe(5);
  });
});
