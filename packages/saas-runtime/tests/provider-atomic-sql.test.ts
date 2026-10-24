import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const sql=readFileSync(new URL("../../../prisma/saas/migrations/20261024_000005_provider_identity/migration.sql",import.meta.url),"utf8");
describe("M30 atomic provider session SQL contract",()=>{
 it("does not grant PUBLIC or tenant roles any identity operations",()=>{
  expect(sql).toContain("REVOKE ALL ON FUNCTION forma_saas.identity_issue_provider_session");
  expect(sql).toContain("REVOKE ALL ON FUNCTION forma_saas.identity_unlink_provider");
  expect(sql).not.toMatch(/\bGRANT\s+EXECUTE\b/i);
  expect(sql).toContain("FORCE ROW LEVEL SECURITY");
 });
 it("rechecks provider status after user row locking and revokes sessions on unlink",()=>{
  expect(sql).toContain("WHERE id=linked_user FOR UPDATE");
  expect(sql).toContain("subject=p_subject FOR UPDATE");
  expect(sql).toContain("link_status IS DISTINCT FROM 'ACTIVE'");
  expect(sql).toContain("UPDATE forma_saas.app_session SET revoked_at=statement_timestamp()");
 });
});
