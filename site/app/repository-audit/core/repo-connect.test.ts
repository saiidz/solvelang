import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCT_APP_INSTALL_URL,
  connectAuditPath,
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
