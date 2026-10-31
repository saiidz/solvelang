import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertDrillCandidate,
  buildInventory,
  chooseRestorePoint,
  drillTargetName,
  sanitizeTableComponent,
} from "../scripts/pitr-restore-drill.mjs";

test("drill target names are prefixed, sanitized, and timestamped", () => {
  const name = drillTargetName(
    "solvelang-api-access-production-AdminCrmTable-ABC123",
    new Date("2026-10-31T14:05:09.123Z"),
  );
  assert.match(name, /^pitr-drill-[a-z0-9_.-]+-20261031t140509$/);
  assert.ok(name.length <= 255);
  assert.equal(sanitizeTableComponent("Weird Name!With#Chars"), "weird-name-with-chars");
});

const resources = [
  { ResourceType: "AWS::DynamoDB::Table", LogicalResourceId: "AdminCrmTable", PhysicalResourceId: "crm-table" },
  { ResourceType: "AWS::Lambda::Function", LogicalResourceId: "ApiAccessFunction", PhysicalResourceId: "fn" },
  { ResourceType: "AWS::DynamoDB::Table", LogicalResourceId: "PlainTable", PhysicalResourceId: "plain-table" },
];
const details = {
  "crm-table": {
    table: { TableStatus: "ACTIVE", ItemCount: 42 },
    backups: {
      PointInTimeRecoveryDescription: {
        PointInTimeRecoveryStatus: "ENABLED",
        EarliestRestorableDateTime: "2026-10-01T00:00:00.000Z",
        LatestRestorableDateTime: "2026-10-31T13:00:00.000Z",
      },
    },
  },
  "plain-table": { table: { TableStatus: "ACTIVE", ItemCount: 7 }, backups: {} },
};

test("inventory keeps only tables and reports deployed PITR state", () => {
  const inventory = buildInventory("stack-a", resources, details);
  assert.equal(inventory.length, 2);
  const crm = inventory.find((entry) => entry.table === "crm-table");
  assert.equal(crm.pitrStatus, "ENABLED");
  assert.equal(crm.itemCount, 42);
  assert.equal(crm.stack, "stack-a");
  const plain = inventory.find((entry) => entry.table === "plain-table");
  assert.equal(plain.pitrStatus, "DISABLED");
});

test("drill candidate must exist in the inventory and have PITR enabled", () => {
  const inventory = buildInventory("stack-a", resources, details);
  assert.equal(assertDrillCandidate(inventory, "crm-table").table, "crm-table");
  assert.throws(() => assertDrillCandidate(inventory, "plain-table"), /does not have PITR enabled/);
  assert.throws(() => assertDrillCandidate(inventory, "missing-table"), /not in the production inventory/);
});

test("restore point is one hour back and must sit inside the restorable window", () => {
  const entry = { earliestRestorable: "2026-10-01T00:00:00.000Z", latestRestorable: "2026-10-31T13:30:00.000Z" };
  const point = chooseRestorePoint(entry, new Date("2026-10-31T14:00:00.000Z"));
  assert.equal(point.toISOString(), "2026-10-31T13:00:00.000Z");
  assert.throws(
    () => chooseRestorePoint({ earliestRestorable: "2026-10-31T13:30:00.000Z", latestRestorable: "2026-10-31T13:45:00.000Z" }, new Date("2026-10-31T14:00:00.000Z")),
    /predates the earliest restorable point/,
  );
  assert.throws(
    () => chooseRestorePoint({ earliestRestorable: "2026-10-01T00:00:00.000Z", latestRestorable: "2026-10-31T12:00:00.000Z" }, new Date("2026-10-31T14:00:00.000Z")),
    /after the latest restorable point/,
  );
});

test("drill workflow is manual, protected, main-only, and queue-serialized", async () => {
  const source = await readFile(new URL("../../../.github/workflows/pitr-restore-drill.yml", import.meta.url), "utf8");
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /environment: api-access-production/);
  assert.match(source, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(source, /solvelang-api-access-production/);
  assert.match(source, /execute_drill:/);
  assert.match(source, /default: false/);
  assert.doesNotMatch(source, /^concurrency:/m);
  assert.match(source, /actions: read/);
  assert.ok(
    source.indexOf("Wait for earlier production deployment requests")
      < source.indexOf("Run PITR inventory or restore drill"),
  );
});
