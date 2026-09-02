"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FIXTURE_SCHEMA = "solvelang.browser-preview-conformance";
const FIXTURE_VERSION = 1;
const CONTRACT = "solvelang.run_pure";
const CONTRACT_VERSION = 1;
const MAX_SOURCE_BYTES = 1_048_576;
const MAX_INPUT_BYTES = 1_048_576;

function exactKeys(value, expected, context) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${context}: fixture keys drifted`);
}

function loadFixtures(fixturePath) {
  const manifest = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  assert.ok(manifest && typeof manifest === "object" && !Array.isArray(manifest), "manifest must be an object");
  exactKeys(manifest, ["schema", "version", "cases"], "manifest");
  assert.equal(manifest.schema, FIXTURE_SCHEMA, "fixture schema drifted");
  assert.equal(manifest.version, FIXTURE_VERSION, "fixture version drifted");
  assert.ok(Array.isArray(manifest.cases) && manifest.cases.length > 0, "fixture cases must be non-empty");

  const ids = new Set();
  for (const fixture of manifest.cases) {
    assert.ok(fixture && typeof fixture === "object" && !Array.isArray(fixture), "fixture case must be an object");
    exactKeys(fixture, ["id", "source", "expect"], "case");
    assert.equal(typeof fixture.id, "string", "fixture id must be text");
    assert.ok(fixture.id.length > 0, "fixture id must not be empty");
    assert.ok(!ids.has(fixture.id), `duplicate fixture id ${JSON.stringify(fixture.id)}`);
    ids.add(fixture.id);
    assert.equal(typeof fixture.source, "string", `${fixture.id}: source must be text`);
    assert.ok(fixture.expect && typeof fixture.expect === "object" && !Array.isArray(fixture.expect), `${fixture.id}: expect must be an object`);

    if (fixture.expect.outcome === "success") {
      exactKeys(fixture.expect, ["outcome", "outputs"], fixture.id);
      assert.ok(Array.isArray(fixture.expect.outputs), `${fixture.id}: outputs must be an array`);
      for (const output of fixture.expect.outputs) {
        assert.ok(
          typeof output === "string" || (typeof output === "number" && Number.isInteger(output)),
          `${fixture.id}: preview-v1 outputs are restricted to text or integers`
        );
      }
    } else if (fixture.expect.outcome === "failure") {
      exactKeys(fixture.expect, ["outcome", "canonical_error"], fixture.id);
      assert.ok(
        fixture.expect.canonical_error === "parse" || fixture.expect.canonical_error === "evaluation",
        `${fixture.id}: canonical failure category drifted outside preview-v1`
      );
    } else {
      assert.fail(`${fixture.id}: outcome must be success or failure`);
    }
  }

  return manifest.cases;
}

function decode(runPure, source, input = "") {
  const response = JSON.parse(runPure(source, input));
  assert.equal(response.contract, CONTRACT, "WASM contract drifted");
  assert.equal(response.version, CONTRACT_VERSION, "WASM contract version drifted");
  return response;
}

function assertLimit(runPure, id, source, input = "") {
  const response = decode(runPure, source, input);
  assert.equal(response.ok, false, `${id}: expected deterministic rejection`);
  assert.deepEqual(response.outputs, [], `${id}: limit failure must not emit output`);
  assert.equal(response.error?.kind, "limit_exceeded", `${id}: wrong failure category`);
  assert.equal(typeof response.error?.message, "string", `${id}: limit diagnostic missing`);
  assert.ok(response.error.message.length > 0, `${id}: limit diagnostic must not be empty`);
}

function runFixtureConformance(runPure, fixtures) {
  for (const fixture of fixtures) {
    const response = decode(runPure, fixture.source);
    if (fixture.expect.outcome === "success") {
      assert.equal(response.ok, true, `${fixture.id}: expected success: ${JSON.stringify(response)}`);
      assert.deepEqual(response.outputs, fixture.expect.outputs, `${fixture.id}: typed output drifted`);
      assert.equal(response.error, null, `${fixture.id}: success carried an error`);
    } else {
      assert.equal(response.ok, false, `${fixture.id}: expected failure: ${JSON.stringify(response)}`);
      assert.equal(
        response.error?.kind,
        fixture.expect.canonical_error,
        `${fixture.id}: canonical failure category drifted`
      );
      assert.equal(typeof response.error?.message, "string", `${fixture.id}: failure diagnostic missing`);
      assert.ok(response.error.message.length > 0, `${fixture.id}: failure diagnostic must not be empty`);
    }
  }
}

function runFixedLimitConformance(runPure) {
  assertLimit(runPure, "source-bytes", "x".repeat(MAX_SOURCE_BYTES + 1));

  const oversizedInput = JSON.stringify("i".repeat(MAX_INPUT_BYTES));
  assert.ok(Buffer.byteLength(oversizedInput, "utf8") > MAX_INPUT_BYTES, "input fixture must cross the byte limit");
  assertLimit(runPure, "input-bytes", "print(1)\n", oversizedInput);

  const chunk = "v".repeat(400_000);
  const valueSource = `let chunk = "${chunk}"\nprint(chunk .. chunk .. chunk)\n`;
  assert.ok(Buffer.byteLength(valueSource, "utf8") < MAX_SOURCE_BYTES, "value fixture must fit the source budget");
  assertLimit(runPure, "value-bytes", valueSource);

  const depthSource = "fn recurse() { return recurse() }\nprint(recurse())\n";
  assertLimit(runPure, "call-depth", depthSource);

  const loopSource = "let n = 0\nwhile true { n = n + 1 }\n";
  assertLimit(runPure, "loop-work", loopSource);

  const stepBody = Array.from({ length: 120 }, () => "n = n + 1").join("\n");
  const stepSource = `let i = 0\nlet n = 0\nwhile i < 5000 {\n${stepBody}\ni = i + 1\n}\n`;
  assert.ok(Buffer.byteLength(stepSource, "utf8") < MAX_SOURCE_BYTES, "step fixture must fit the source budget");
  assertLimit(runPure, "global-steps", stepSource);
}

function main() {
  const bindingPath = process.argv[2];
  const fixturePath = process.argv[3];
  assert.ok(bindingPath, "usage: node wasm-conformance.cjs <generated-binding.js> <fixture.json>");
  assert.ok(fixturePath, "fixture path is required");

  const binding = require(path.resolve(bindingPath));
  assert.equal(typeof binding.run_pure_v1, "function", "generated WASM binding must expose run_pure_v1");

  const fixtures = loadFixtures(path.resolve(fixturePath));
  runFixtureConformance(binding.run_pure_v1, fixtures);
  runFixedLimitConformance(binding.run_pure_v1);
  console.log(`WASM conformance PASS: ${fixtures.length} shared fixtures + 6 fixed limit cases`);
}

main();
