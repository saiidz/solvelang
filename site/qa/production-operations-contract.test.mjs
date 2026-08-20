import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const operationsUrl = new URL("../../docs/production-operations.md", import.meta.url);
const monitoringContractUrl = new URL("../../docs/production-monitoring-contract.json", import.meta.url);

test("production operations runbook requires a sanitized incident record and verified closure", async () => {
  const runbook = await readFile(operationsUrl, "utf8");

  assert.match(runbook, /## Incident record and redaction gate/);
  assert.match(runbook, /unknown impact recorded as `unknown` rather than guessed/);
  assert.match(runbook, /sanitized request IDs or error codes/);
  assert.match(runbook, /Do not put live secrets, API keys, webhook payloads\/signing secrets/);
  assert.match(runbook, /raw log bodies, or recovery codes/);
  assert.match(runbook, /verified recovery, a completed state-preserving rollback, or an explicit handoff/);
  assert.match(runbook, /Do not mark recovery solely because an alert stopped firing/);
});

test("production operations log policy excludes raw request and exception material", async () => {
  const runbook = await readFile(operationsUrl, "utf8");

  assert.match(runbook, /raw request or response bodies/);
  assert.match(runbook, /caught exception messages or stack traces/);
});

test("restore drills require an isolated target and preserve active application routing", async () => {
  const runbook = await readFile(operationsUrl, "utf8");

  assert.match(runbook, /intended UTC recovery point/);
  assert.match(runbook, /recovery table name differs from the source/);
  assert.match(runbook, /not referenced by active application configuration, aliases, or traffic routes/);
  assert.match(runbook, /abort the drill if that cannot be established/);
  assert.match(runbook, /do not switch application configuration as part of the drill/);
  assert.match(runbook, /Never overwrite a healthy production table during a drill/);
});

test("monitoring readiness contract keeps future auth, billing, and queue gates provider-neutral", async () => {
  const contract = JSON.parse(await readFile(monitoringContractUrl, "utf8"));

  assert.equal(contract.schemaVersion, "solvelang.production-monitoring-contract.v1");
  assert.equal(contract.mode, "repository-readiness-only");
  assert.equal(contract.authorizesDeployment, false);
  assert.deepEqual(contract.surfaces.map((surface) => surface.id), ["customer-auth", "subscription-billing", "priority-queue"]);
  assert.deepEqual(contract.surfaces[0].signals, [
    "customer-api-lambda-errors",
    "customer-api-lambda-throttles",
    "authorizer-lambda-errors",
    "authorizer-lambda-throttles",
    "sanitized-authorization-denial-spike",
  ]);
  assert.deepEqual(contract.surfaces[1].signals, [
    "webhook-processing-failure",
    "webhook-handler-lambda-errors",
    "stripe-webhook-delivery-health",
  ]);
  assert.deepEqual(contract.surfaces[2].signals, [
    "queue-visible-messages",
    "queue-oldest-message-age",
    "queue-dead-letter-messages",
    "worker-lambda-errors",
    "worker-lambda-throttles",
  ]);
  assert.match(contract.prohibitions.join("\n"), /No provider account, topic, destination, resource identifier, credential, or deployment configuration/);
});
