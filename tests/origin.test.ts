import { describe, expect, it } from "vitest";
import { sameOrigin } from "../src/lib/origin";

const codespaces = {
  CODESPACES: "true",
  CODESPACE_NAME: "fictional-space-abc123",
  GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
  PORT: "3000"
};

function makeRequest(origin: string | null, host: string | null = null, url = "http://127.0.0.1:3000/api/auth/login") {
  const headers = new Headers();
  if (origin !== null) headers.set("Origin", origin);
  if (host !== null) headers.set("Host", host);
  return new Request(url, { method: "POST", headers });
}

describe("POST origin validation", () => {
  it("accepts direct same-origin localhost requests", () => {
    expect(sameOrigin(makeRequest("http://127.0.0.1:3000"), {})).toBe(true);
  });
  it("accepts exact Codespaces forwarded origin behind localhost", () => {
    expect(sameOrigin(makeRequest("https://fictional-space-abc123-3000.app.github.dev"), codespaces)).toBe(true);
  });
  it("rejects other Codespaces instances and ports", () => {
    expect(sameOrigin(makeRequest("https://other-space-3000.app.github.dev"), codespaces)).toBe(false);
    expect(sameOrigin(makeRequest("https://fictional-space-4000.app.github.dev"), codespaces)).toBe(false);
  });
  it("rejects Codespaces preview hosts outside the Codespaces environment", () => {
    expect(sameOrigin(makeRequest("https://fictional-space-abc123-3000.app.github.dev"), {})).toBe(false);
  });
  it("accepts matching external Host for a localhost reverse proxy", () => {
    expect(sameOrigin(makeRequest("https://store.example", "store.example"), {})).toBe(true);
    expect(sameOrigin(makeRequest("https://evil.example", "store.example"), {})).toBe(false);
  });
  it("rejects cross-site and malformed origins", () => {
    expect(sameOrigin(makeRequest("https://example.com"), codespaces)).toBe(false);
    expect(sameOrigin(makeRequest("https://fictional-space-abc123-3000.app.github.dev.evil.com"), codespaces)).toBe(false);
    expect(sameOrigin(makeRequest("null"), codespaces)).toBe(false);
    expect(sameOrigin(makeRequest("https://fictional-space-abc123-3000.app.github.dev/path"), codespaces)).toBe(false);
  });
  it("preserves existing Origin-absent behavior (auth still required)", () => {
    expect(sameOrigin(makeRequest(null), codespaces)).toBe(true);
  });
});
