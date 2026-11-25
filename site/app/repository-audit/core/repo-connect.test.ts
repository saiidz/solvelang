import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCT_APP_INSTALL_URL,
  boundAuditSelection,
  connectAuditPath,
  connectBindingsPath,
  connectRepositoriesPath,
  parseInstallationId,
  parseRepoSlug,
} from "./repo-connect";

test("the connect button targets the branded product app install flow", () => {
  assert.equal(
    PRODUCT_APP_INSTALL_URL,
    "https://github.com/apps/solvelang-process-solution/installations/new",
  );
});

test("repo slugs parse only the exact owner/repo shape", () => {
  assert.deepEqual(parseRepoSlug("acme/alpha"), { owner: "acme", repo: "alpha" });
  assert.deepEqual(parseRepoSlug("  acme/alpha-2.0  "), { owner: "acme", repo: "alpha-2.0" });
  assert.equal(parseRepoSlug("alpha"), null);
  assert.equal(parseRepoSlug("acme/alpha/extra"), null);
  assert.equal(parseRepoSlug("https://github.com/acme/alpha"), null);
  assert.equal(parseRepoSlug("acme/"), null);
  assert.equal(parseRepoSlug("/alpha"), null);
  assert.equal(parseRepoSlug("ac me/alpha"), null);
  assert.equal(parseRepoSlug(""), null);
});

test("installation ids parse only positive integers", () => {
  assert.equal(parseInstallationId("179351888"), 179351888);
  assert.equal(parseInstallationId(" 42 "), 42);
  assert.equal(parseInstallationId("0"), null);
  assert.equal(parseInstallationId("-3"), null);
  assert.equal(parseInstallationId("4.5"), null);
  assert.equal(parseInstallationId("abc"), null);
  assert.equal(parseInstallationId(""), null);
});

test("proxy paths carry the identifiers the api-access routes require", () => {
  assert.equal(
    connectRepositoriesPath(123),
    "/customer/connect/repositories?installationId=123",
  );
  assert.equal(
    connectAuditPath(123, "acme", "alpha"),
    "/customer/connect/audit?installationId=123&owner=acme&repo=alpha",
  );
});

test("the discovery read is the session bindings route", () => {
  assert.equal(connectBindingsPath(), "/customer/github/bindings");
});

test("bound repositories shape into audit selections without typing", () => {
  assert.deepEqual(
    boundAuditSelection({ fullName: "saiidz/upcomingsounds-private", installationId: 182088702 }),
    { installationId: 182088702, owner: "saiidz", repo: "upcomingsounds-private" },
  );
  // A bindings entry without its installation cannot be audited
  // from the list — the panel falls back to the manual entry.
  assert.equal(boundAuditSelection({ fullName: "acme/alpha", installationId: null }), null);
  assert.equal(boundAuditSelection({ fullName: "acme/alpha", installationId: 0 }), null);
  assert.equal(boundAuditSelection({ fullName: "acme/alpha", installationId: -3 }), null);
  assert.equal(boundAuditSelection({ fullName: "not-a-slug", installationId: 42 }), null);
  assert.equal(boundAuditSelection({ fullName: "acme/alpha/extra", installationId: 42 }), null);
});
