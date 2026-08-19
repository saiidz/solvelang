import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaUrl = new URL("../../../../../schemas/repository-audit-report.schema.json", import.meta.url);

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as JsonObject;
}

function strings(value: unknown, label: string): string[] {
  assert.ok(Array.isArray(value) && value.every((item) => typeof item === "string"), `${label} must be strings`);
  return value;
}

async function schema() {
  return JSON.parse(await readFile(schemaUrl, "utf8")) as JsonObject;
}

test("published Repository Audit schema pins versioned strict report extensions", async () => {
  const root = await schema();
  assert.equal(root.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(root.additionalProperties, false);

  const properties = object(root.properties, "properties");
  const schemaVersion = object(properties.schemaVersion, "schemaVersion");
  assert.deepEqual(strings(schemaVersion.enum, "schemaVersion.enum"), ["1.0.0", "1.1.0", "1.2.0"]);

  const definitions = object(root.$defs, "$defs");
  const graph = object(definitions.graphIntelligence, "graphIntelligence");
  const affected = object(definitions.affectedValidation, "affectedValidation");
  assert.equal(graph.additionalProperties, false);
  assert.equal(affected.additionalProperties, false);

  const variants = root.allOf;
  assert.ok(Array.isArray(variants) && variants.length === 3);
  const v12 = variants.find((variant) => {
    const item = object(variant, "version variant");
    const condition = object(item.if, "version condition");
    const conditionProperties = object(condition.properties, "version condition properties");
    return object(conditionProperties.schemaVersion, "version condition schemaVersion").const === "1.2.0";
  });
  assert.ok(v12);
  assert.deepEqual(strings(object(v12, "v1.2 variant").then && object(object(v12, "v1.2 variant").then, "v1.2 then").required, "v1.2 required"), ["graph", "affectedValidation"]);
});

test("published schema preserves redaction and bounded-stage truncation truth", async () => {
  const root = await schema();
  const properties = object(root.properties, "properties");
  const execution = object(properties.execution, "execution");
  const executionProperties = object(execution.properties, "execution properties");
  const truncationReasons = object(executionProperties.truncationReasons, "truncation reasons");
  const truncationItems = object(truncationReasons.items, "truncation reason items");
  const reasons = strings(truncationItems.enum, "truncation reason enum");
  for (const reason of [
    "dependency-consistency:finding-count",
    "coverage-map:mapping-count",
    "coverage-map:sample-count",
    "dead-code:candidate-count",
    "configuration:reference-count",
    "workflow-path:reference-count",
    "affected-validation:changed-path-count",
    "affected-validation:mapping-count",
  ]) {
    assert.ok(reasons.includes(reason), `missing canonical truncation reason ${reason}`);
  }

  const definitions = object(root.$defs, "$defs");
  const warning = object(definitions.redactedSecretWarning, "redactedSecretWarning");
  const required = strings(warning.required, "redactedSecretWarning.required");
  assert.ok(required.includes("remediation"));
  assert.ok(!required.includes("fingerprint"));

  const redaction = object(properties.redaction, "redaction");
  const redactionProperties = object(redaction.properties, "redaction properties");
  assert.equal(object(redactionProperties.secretValuesIncluded, "secretValuesIncluded").const, false);
  assert.equal(object(redactionProperties.secretCorrelationFingerprintsIncluded, "secretCorrelationFingerprintsIncluded").const, false);
});
