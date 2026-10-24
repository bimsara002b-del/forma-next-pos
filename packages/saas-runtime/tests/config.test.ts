import { describe, it, expect } from "vitest";
import { validateConnectionUrl } from "../src/runtime";
describe("explicit PostgreSQL configuration", () => {
 it.each([undefined,"","file:./demo.db","https://db.test","postgresql://localhost/"])(
  "rejects missing/unsupported target %s", value => expect(() => validateConnectionUrl(value)).toThrow());
 it("preserves TLS configuration", () => {
  const url="postgresql://app:password@db.test/forma?sslmode=verify-full";
  expect(validateConnectionUrl(url)).toBe(url);
 });
});
