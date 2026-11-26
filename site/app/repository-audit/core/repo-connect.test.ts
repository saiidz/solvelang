import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIT_PLATFORMS,
  PLATFORM_AUDIT_AWAITING_COPY,
  PRODUCT_APP_INSTALL_URL,
  boundAuditSelection,
  buildPlatformConnectionPayload,
  connectAuditPath,
  connectBindingsPath,
  connectRepositoriesPath,
  connectionsReadFailed,
  noConnectionsApplies,
  normalizePlatformConnections,
  parseInstallationId,
  parseRepoSlug,
  parseRepositoryLines,
  platformAuditStateCopy,
  platformConnectionAuditPath,
  platformConnectionTitle,
  platformConnectionsPath,
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

test("the platform picker offers exactly the five doors, GitHub first", () => {
  assert.deepEqual(
    AUDIT_PLATFORMS.map((entry) => entry.id),
    ["github", "gitlab", "azure", "bitbucket", "forge"],
  );
  assert.deepEqual(
    AUDIT_PLATFORMS.map((entry) => entry.label),
    ["GitHub", "GitLab", "Azure DevOps", "Bitbucket", "Forgejo / Gitea"],
  );
});

test("the platform doors call the platform-connections routes", () => {
  assert.equal(platformConnectionsPath(), "/customer/platform-connections");
  assert.equal(platformConnectionAuditPath(), "/customer/platform-connections/audit");
});

test("repository lines parse trimmed, de-duplicated, one per line", () => {
  assert.deepEqual(parseRepositoryLines("group/project\n\n group/project \nacme/alpha\n"), ["group/project", "acme/alpha"]);
  assert.deepEqual(parseRepositoryLines(""), []);
  assert.deepEqual(parseRepositoryLines("  \n \n"), []);
});

test("payload building accepts each platform's own shape", () => {
  const gitlab = buildPlatformConnectionPayload({
    platform: "gitlab", baseUrl: "https://gitlab.example.com/", organization: "", project: "", workspace: "",
    repositories: ["group/project"], token: "",
  });
  assert.deepEqual(gitlab, { ok: true, payload: { platform: "gitlab", repositories: ["group/project"], baseUrl: "https://gitlab.example.com" } });

  const azure = buildPlatformConnectionPayload({
    platform: "azure", baseUrl: "", organization: " Acme Org ", project: "Platform", workspace: "",
    repositories: ["api service"], token: "xoxb-test-token-123456",
  });
  assert.deepEqual(azure, {
    ok: true,
    payload: { platform: "azure", repositories: ["api service"], token: "xoxb-test-token-123456", organization: "Acme Org", project: "Platform" },
  });

  const bitbucket = buildPlatformConnectionPayload({
    platform: "bitbucket", baseUrl: "", organization: "", project: "", workspace: "acme",
    repositories: ["alpha"], token: "",
  });
  assert.deepEqual(bitbucket, { ok: true, payload: { platform: "bitbucket", repositories: ["alpha"], workspace: "acme" } });
});

test("payload building refuses malformed shapes with a reason, mirroring the server", () => {
  const base = { baseUrl: "", organization: "", project: "", workspace: "", repositories: [] as string[], token: "" };
  assert.equal(buildPlatformConnectionPayload({ ...base, platform: "gitlab", baseUrl: "https://g.example.com", repositories: [] }).ok, false);
  assert.equal(buildPlatformConnectionPayload({ ...base, platform: "gitlab", baseUrl: "http://g.example.com", repositories: ["g/p"] }).ok, false);
  assert.equal(buildPlatformConnectionPayload({ ...base, platform: "gitlab", baseUrl: "https://g.example.com", repositories: ["baregroup"] }).ok, false);
  assert.equal(buildPlatformConnectionPayload({ ...base, platform: "forge", baseUrl: "https://g.example.com", repositories: ["a/b/c"] }).ok, false);
  assert.equal(buildPlatformConnectionPayload({ ...base, platform: "azure", organization: "acme", project: "core", repositories: ["has/slash"] }).ok, false);
  assert.equal(buildPlatformConnectionPayload({ ...base, platform: "bitbucket", workspace: "ac me", repositories: ["alpha"] }).ok, false);
  assert.equal(buildPlatformConnectionPayload({ ...base, platform: "bitbucket", workspace: "acme", repositories: ["alpha"], token: "short" }).ok, false);
});

test("connection lists normalize defensively — malformed entries drop, never render", () => {
  const connections = normalizePlatformConnections({
    connections: [
      {
        connectionId: "c1", platform: "gitlab", baseUrl: "https://gitlab.example.com",
        repositories: ["g/p"], tokenStored: true, tokenFingerprint: "0123456789ab",
        auditState: "awaiting_configuration",
      },
      { connectionId: "c2", platform: "github", repositories: ["a/b"] },
      { connectionId: "", platform: "forge", repositories: ["a/b"] },
      { connectionId: "c3", platform: "azure", organization: "acme", project: "core", repositories: [] },
      "junk",
      null,
    ],
  });
  assert.equal(connections.length, 1);
  assert.equal(connections[0].connectionId, "c1");
  assert.equal(connections[0].tokenFingerprint, "0123456789ab");
  assert.deepEqual(normalizePlatformConnections(null), []);
  assert.deepEqual(normalizePlatformConnections({}), []);
  assert.deepEqual(normalizePlatformConnections({ connections: "nope" }), []);
});

test("connection titles speak each platform's own terms", () => {
  const base = { repositories: ["x"], tokenStored: false, tokenFingerprint: null, auditState: "awaiting_configuration" };
  assert.equal(platformConnectionTitle({ ...base, connectionId: "1", platform: "gitlab", baseUrl: "https://gitlab.example.com" }), "https://gitlab.example.com");
  assert.equal(platformConnectionTitle({ ...base, connectionId: "2", platform: "azure", organization: "acme", project: "core" }), "acme / core");
  assert.equal(platformConnectionTitle({ ...base, connectionId: "3", platform: "bitbucket", workspace: "acme" }), "acme");
  assert.equal(platformConnectionTitle({ ...base, connectionId: "4", platform: "forge", baseUrl: "https://git.example.com" }), "https://git.example.com");
});

test("the awaiting-configuration copy is the honest status, verbatim", () => {
  assert.equal(
    platformAuditStateCopy("awaiting_configuration"),
    "Connection saved — the first live audit for this platform is enabled when its access is configured. Nothing has been run against your repository yet.",
  );
  assert.equal(PLATFORM_AUDIT_AWAITING_COPY, platformAuditStateCopy("awaiting_configuration"));
});

test("the empty-list copy applies only when every read succeeded and found nothing", () => {
  // Both reads ready and empty: the ONLY case the copy may show.
  assert.equal(noConnectionsApplies("ready", "ready", 0, 0), true);
  // A failed read is a loading problem, never an empty list.
  assert.equal(noConnectionsApplies("failed", "ready", 0, 0), false);
  assert.equal(noConnectionsApplies("ready", "failed", 0, 0), false);
  assert.equal(noConnectionsApplies("failed", "failed", 0, 0), false);
  // Still loading, or something actually connected: no copy.
  assert.equal(noConnectionsApplies("loading", "ready", 0, 0), false);
  assert.equal(noConnectionsApplies("ready", "ready", 2, 0), false);
  assert.equal(noConnectionsApplies("ready", "ready", 0, 1), false);
  assert.equal(connectionsReadFailed("failed", "ready"), true);
  assert.equal(connectionsReadFailed("ready", "failed"), true);
  assert.equal(connectionsReadFailed("ready", "ready"), false);
  assert.equal(connectionsReadFailed("loading", "ready"), false);
});
