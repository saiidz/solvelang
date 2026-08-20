import assert from "node:assert/strict";
import test from "node:test";
import { analyzeDockerComposeServiceRelationships } from "./dockerComposeServiceRelationships";

test("collects deterministic explicit Compose depends_on relationships without evaluation", () => {
  const result = analyzeDockerComposeServiceRelationships(`
services:
  api:
    depends_on:
      - db
      - "cache"
  worker:
    depends_on:
      db:
        condition: service_started
      missing-service:
        condition: service_healthy
  scheduler:
    depends_on: [db, 'cache']
  db:
    image: postgres:17
  cache:
    image: redis:7
`);

  assert.equal(result.status, "complete");
  assert.deepEqual(result.services, ["api", "cache", "db", "scheduler", "worker"]);
  assert.deepEqual(result.relationships, [
    {
      relationshipId: "docker-compose:depends-on:api:cache",
      kind: "depends-on",
      fromService: "api",
      toService: "cache",
      targetState: "present",
      evidence: { field: "depends_on", syntax: "list" },
    },
    {
      relationshipId: "docker-compose:depends-on:api:db",
      kind: "depends-on",
      fromService: "api",
      toService: "db",
      targetState: "present",
      evidence: { field: "depends_on", syntax: "list" },
    },
    {
      relationshipId: "docker-compose:depends-on:scheduler:cache",
      kind: "depends-on",
      fromService: "scheduler",
      toService: "cache",
      targetState: "present",
      evidence: { field: "depends_on", syntax: "inline-list" },
    },
    {
      relationshipId: "docker-compose:depends-on:scheduler:db",
      kind: "depends-on",
      fromService: "scheduler",
      toService: "db",
      targetState: "present",
      evidence: { field: "depends_on", syntax: "inline-list" },
    },
    {
      relationshipId: "docker-compose:depends-on:worker:db",
      kind: "depends-on",
      fromService: "worker",
      toService: "db",
      targetState: "present",
      evidence: { field: "depends_on", syntax: "mapping" },
    },
    {
      relationshipId: "docker-compose:depends-on:worker:missing-service",
      kind: "depends-on",
      fromService: "worker",
      toService: "missing-service",
      targetState: "missing",
      evidence: { field: "depends_on", syntax: "mapping" },
    },
  ]);
  assert.deepEqual(result.summary, {
    servicesSeen: 5,
    relationshipsSeen: 6,
    relationshipsReturned: 6,
    relationshipsHidden: 0,
    missingTargets: 1,
    unsupportedReferences: 0,
    duplicateRelationships: 0,
  });
  assert.deepEqual(result.execution, {
    composeEvaluation: false,
    containerStart: false,
    networkAccess: false,
    writeAccess: false,
    maxComposeBytes: 1024 * 1024,
    maxRelationships: 1_000,
  });
});

test("accepts quoted static Compose service and dependency keys", () => {
  const result = analyzeDockerComposeServiceRelationships(`
services:
  "api.service":
    depends_on:
      'db-primary':
        condition: service_healthy
  'db-primary':
    image: postgres:17
`);

  assert.equal(result.status, "complete");
  assert.deepEqual(result.services, ["api.service", "db-primary"]);
  assert.deepEqual(result.relationships, [
    {
      relationshipId: "docker-compose:depends-on:api.service:db-primary",
      kind: "depends-on",
      fromService: "api.service",
      toService: "db-primary",
      targetState: "present",
      evidence: { field: "depends_on", syntax: "mapping" },
    },
  ]);
  assert.equal(result.summary.unsupportedReferences, 0);
});

test("reports unsupported dynamic references and deduplicates repeated relationships", () => {
  const result = analyzeDockerComposeServiceRelationships(`
services:
  web:
    depends_on: ${"${DEPENDENCIES}"}
  worker:
    depends_on:
      - db
      - db
      - ${"${DYNAMIC_SERVICE}"}
  db:
    image: postgres:17
`);

  assert.equal(result.status, "partial");
  assert.deepEqual(result.relationships.map((relationship) => `${relationship.fromService}->${relationship.toService}`), ["worker->db"]);
  assert.equal(result.summary.unsupportedReferences, 2);
  assert.equal(result.summary.duplicateRelationships, 1);
});

test("applies the relationship bound only after deterministic ordering", () => {
  const result = analyzeDockerComposeServiceRelationships(`
services:
  app:
    depends_on:
      - z
      - a
  z:
    image: z:1
  a:
    image: a:1
`, { maxRelationships: 1 });

  assert.equal(result.status, "partial");
  assert.deepEqual(result.relationships.map((relationship) => relationship.toService), ["a"]);
  assert.equal(result.summary.relationshipsSeen, 2);
  assert.equal(result.summary.relationshipsReturned, 1);
  assert.equal(result.summary.relationshipsHidden, 1);
});

test("rejects invalid bounds and oversized Compose text", () => {
  assert.throws(
    () => analyzeDockerComposeServiceRelationships("services:\n", { maxRelationships: 0 }),
    /maxRelationships must be an integer from 1 through 2000/,
  );
  assert.throws(
    () => analyzeDockerComposeServiceRelationships("x".repeat(1024 * 1024 + 1)),
    /1 MiB text bound/,
  );
});
