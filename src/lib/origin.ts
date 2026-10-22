/**
 * Validate browser Origin for POST mutations.
 * Codespaces forwards HTTPS requests to an internal Next.js HTTP server.
 * Compare exact trusted browser authority, never wildcard GitHub subdomains.
 */
type OriginEnvironment = Pick<
  NodeJS.ProcessEnv,
  "CODESPACES" | "CODESPACE_NAME" | "GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN" | "PORT"
>;

export function sameOrigin(request: Request, environment: OriginEnvironment = process.env): boolean {
  const originHeader = request.headers.get("origin");
  // Preserve compatibility with non-browser clients. Session auth is still
  // independently required for all protected mutating endpoints.
  if (originHeader === null) return true;

  let browserOrigin: URL;
  let serverUrl: URL;
  try {
    browserOrigin = new URL(originHeader);
    serverUrl = new URL(request.url);
  } catch {
    return false;
  }

  // Origin must be a plain origin, not a URL path or forged wildcard.
  if (!["https:", "http:"].includes(browserOrigin.protocol) ||
      browserOrigin.origin !== originHeader ||
      browserOrigin.username || browserOrigin.password) return false;

  // Direct local URL, or properly reconstructed public URL.
  if (browserOrigin.origin === serverUrl.origin) return true;

  // When a reverse proxy retains the external Host header but Next.js uses
  // an internal request URL, browser Origin can match Host exactly.
  // Do not automatically trust arbitrary X-Forwarded-Host values.
  const host = request.headers.get("host");
  if (host === browserOrigin.host) {
    const internalHost = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(serverUrl.hostname);
    if (serverUrl.protocol === browserOrigin.protocol || internalHost) return true;
  }

  // GitHub Codespaces supplies an exact named forwarded HTTPS endpoint.
  // Accept this origin only inside Codespaces, with the expected app port.
  if (environment.CODESPACES === "true") {
    const name = environment.CODESPACE_NAME;
    const domain = environment.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
    const port = environment.PORT || "3000";
    if (name && domain && /^[0-9]{2,5}$/.test(port)) {
      const expectedOrigin = "https://" + name + "-" + port + "." + domain;
      if (browserOrigin.origin === expectedOrigin) return true;
    }
  }

  return false;
}
