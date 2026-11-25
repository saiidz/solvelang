import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// QA pins for the repository-audit wiring repair: every SAM
// function that runs src/handler.handler constructs the
// run-telemetry Dynamo store at module top level, and that
// store throws when RUN_TELEMETRY_TABLE is empty — so a
// function whose template environment omits the variable
// fails init on every invocation and API Gateway answers its
// generic 500 for every route on it. That is exactly how
// GitHubFunction (and with it /customer/github/bindings, the
// connected-repositories read the audit page discovers from)
// went dark while ApiAccessFunction kept answering. These
// pins keep the variable plumbed to every handler function.

const templateUrl = new URL("../template.yaml", import.meta.url);

function resourceBlock(source, name) {
  const start = source.indexOf(`\n  ${name}:`);
  assert.notEqual(start, -1, `${name} exists in the template`);
  const rest = source.slice(start + 1);
  const next = rest.slice(name.length + 3).search(/\n  [A-Z][A-Za-z0-9]+:/);
  return next === -1 ? rest : rest.slice(0, name.length + 3 + next);
}

function serverlessFunctionNames(source) {
  const resources = source.slice(source.indexOf("\nResources:"));
  return [...resources.matchAll(/\n  ([A-Z][A-Za-z0-9]+):\n    Type: AWS::Serverless::Function/g)]
    .map((match) => match[1]);
}

test("every src/handler.handler function declares RUN_TELEMETRY_TABLE", async () => {
  const source = await readFile(templateUrl, "utf8");
  const names = serverlessFunctionNames(source);
  const handlerFunctions = names.filter((name) => resourceBlock(source, name).includes("Handler: src/handler.handler"));
  assert.ok(handlerFunctions.length >= 5, `expected at least 5 handler functions, saw ${handlerFunctions.join(", ")}`);
  for (const name of handlerFunctions) {
    const block = resourceBlock(source, name);
    assert.ok(
      block.includes("RUN_TELEMETRY_TABLE: !Ref RunTelemetryTable"),
      `${name} runs src/handler.handler, whose module init throws without RUN_TELEMETRY_TABLE`,
    );
  }
});

test("GitHubFunction declares RUN_TELEMETRY_TABLE (the bindings read lives there)", async () => {
  const source = await readFile(templateUrl, "utf8");
  const block = resourceBlock(source, "GitHubFunction");
  assert.ok(block.includes("Path: /customer/github/bindings"), "GitHubFunction serves the bindings route");
  assert.ok(
    block.includes("RUN_TELEMETRY_TABLE: !Ref RunTelemetryTable"),
    "GitHubFunction must declare RUN_TELEMETRY_TABLE or every route on it 500s at init",
  );
});
