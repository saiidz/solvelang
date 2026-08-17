import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

type SchemaNode = {
  type?: string;
  additionalProperties?: boolean;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  required?: string[];
  maxItems?: number;
};

function loadSchema(): SchemaNode {
  const path = resolve(process.cwd(), "../schemas/server-audit-snapshot.schema.json");
  return JSON.parse(readFileSync(path, "utf8")) as SchemaNode;
}

function property(node: SchemaNode, name: string): SchemaNode {
  const child = node.properties?.[name];
  assert.ok(child, `schema property ${name} must exist`);
  return child;
}

function objectKeys(node: SchemaNode): string[] {
  assert.equal(node.type, "object");
  assert.equal(node.additionalProperties, false);
  return Object.keys(node.properties ?? {}).sort();
}

function itemObjectKeys(node: SchemaNode): string[] {
  assert.equal(node.type, "array");
  assert.ok(node.items, "array schema must define items");
  return objectKeys(node.items);
}

test("Server Audit JSON schema pins the parser and collector field surface", () => {
  const root = loadSchema();
  assert.deepEqual(objectKeys(root), [
    "backups",
    "collectedAt",
    "filesystems",
    "host",
    "listeningSockets",
    "logs",
    "metadata",
    "packages",
    "processes",
    "scheduledJobs",
    "schemaVersion",
    "security",
    "services",
    "system",
    "web",
  ]);

  assert.deepEqual(objectKeys(property(root, "host")), ["architecture", "hostname", "kernel", "os"]);
  assert.deepEqual(objectKeys(property(root, "system")), ["load", "memoryAvailableBytes", "memoryTotalBytes", "uptimeSeconds"]);
  assert.deepEqual(itemObjectKeys(property(root, "filesystems")), ["availableBytes", "filesystem", "mount", "sizeBytes", "usagePercent", "usedBytes"]);
  assert.deepEqual(itemObjectKeys(property(root, "listeningSockets")), ["localAddress", "port", "process", "protocol"]);
  assert.deepEqual(itemObjectKeys(property(root, "processes")), ["name", "pid", "ppid", "state", "uid"]);
  assert.deepEqual(itemObjectKeys(property(root, "services")), ["enabled", "name", "state"]);
  assert.deepEqual(itemObjectKeys(property(root, "packages")), ["name", "version"]);
  assert.deepEqual(itemObjectKeys(property(root, "scheduledJobs")), ["commandSummary", "schedule", "source"]);
  assert.deepEqual(itemObjectKeys(property(root, "backups")), ["ageHours", "name", "path", "sizeBytes"]);
  assert.deepEqual(itemObjectKeys(property(root, "logs")), ["modifiedAt", "path", "sizeBytes"]);
  assert.deepEqual(objectKeys(property(root, "security")), ["apparmor", "automaticUpdates", "firewall", "passwordSshLogin", "rootSshLogin", "selinux"]);
  assert.deepEqual(objectKeys(property(root, "metadata")), ["collectorVersion", "notes", "redactionsApplied"]);

  const web = property(root, "web");
  assert.deepEqual(objectKeys(web), ["certificates", "roots", "servers"]);
  assert.deepEqual(itemObjectKeys(property(web, "roots")), ["frameworkHints", "mode", "owner", "path"]);
  assert.deepEqual(itemObjectKeys(property(web, "certificates")), ["daysRemaining", "name", "notAfter"]);
});

test("Server Audit JSON schema preserves the same collection bounds as the parser", () => {
  const root = loadSchema();
  assert.equal(property(root, "filesystems").maxItems, 5000);
  assert.equal(property(root, "listeningSockets").maxItems, 5000);
  assert.equal(property(root, "processes").maxItems, 5000);
  assert.equal(property(root, "services").maxItems, 5000);
  assert.equal(property(root, "packages").maxItems, 5000);
  assert.equal(property(root, "scheduledJobs").maxItems, 5000);
  assert.equal(property(root, "backups").maxItems, 1000);
  assert.equal(property(root, "logs").maxItems, 1000);

  const web = property(root, "web");
  assert.equal(property(web, "servers").maxItems, 50);
  assert.equal(property(web, "roots").maxItems, 500);
  assert.equal(property(web, "certificates").maxItems, 500);
});