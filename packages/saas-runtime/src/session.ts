import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "../generated/client";

/** Read only the dedicated cookie in the current server request; never a user ID. */
export type SessionTokenReader = () => Promise<string | undefined>;
export const SAAS_SESSION_COOKIE = "__Host-forma_saas_session";
export const SAAS_SESSION_MAX_AGE = 8 * 60 * 60;
export const SAAS_SESSION_COOKIE_OPTIONS = {
  httpOnly: true, secure: true, sameSite: "lax" as const, path: "/",
  maxAge: SAAS_SESSION_MAX_AGE
};

/** Credential generation is not authentication. Only a trusted identity service
 * may persist the hash after verified login; never log token OR hash. */
export function createSessionCredential() {
  if ("window" in globalThis) throw new Error("SERVER_ONLY_RUNTIME");
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: hashSessionToken(token)! };
}
export function hashSessionToken(token: string | undefined): string | null {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return null;
  return createHash("sha256").update(token).digest("hex");
}

/** Called only inside the guarded runtime transaction, before tenant selection. */
export async function resolveDatabaseSession(tx: Prisma.TransactionClient, tokenHash: string) {
  await tx.$queryRaw`SELECT set_config('app.session_hash', ${tokenHash}, true)`;
  const rows = await tx.$queryRaw<{ userId: string }[]>`
    SELECT s.user_id AS "userId" FROM forma_saas.app_session s
    JOIN forma_saas.app_user u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash} AND s.revoked_at IS NULL
      AND s.expires_at > statement_timestamp() AND u.status = 'ACTIVE'
    LIMIT 1`;
  return rows[0] ?? null;
}
