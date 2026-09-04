import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { runSolveLangPreview } from "./browserRunner";

const FIXTURE_SCHEMA = "solvelang.browser-preview-conformance";
const FIXTURE_VERSION = 1;
const fixturePath = path.resolve(
  __dirname,
  "../../../../conformance/browser-preview-v1.json"
);

type FixtureValue = string | number;

type FixtureCase = {
  id: string;
  source: string;
  expect:
    | { outcome: "success"; outputs: FixtureValue[] }
    | { outcome: "failure"; canonical_error: "parse" | "evaluation" };
};

function exactKeys(value: Record<string, unknown>, expected: string[], context: string) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${context}: fixture keys drifted`);
}

function loadFixtures(): FixtureCase[] {
  const parsed: unknown = JSON.parse(readFileSync(fixturePath, "utf8"));
  assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed), "manifest must be an object");
  const manifest = parsed as Record<string, unknown>;
  exactKeys(manifest, ["schema", "version", "cases"], "manifest");
  assert.equal(manifest.schema, FIXTURE_SCHEMA, "fixture schema must be explicitly versioned");
  assert.equal(manifest.version, FIXTURE_VERSION, "fixture version drift must fail closed");
  assert.ok(Array.isArray(manifest.cases) && manifest.cases.length > 0, "fixture manifest must not be empty");

  const ids = new Set<string>();
  return manifest.cases.map((rawCase, index) => {
    assert.ok(rawCase && typeof rawCase === "object" && !Array.isArray(rawCase), `case ${index} must be an object`);
    const fixture = rawCase as Record<string, unknown>;
    exactKeys(fixture, ["id", "source", "expect"], `case ${index}`);
    assert.equal(typeof fixture.id, "string", `case ${index}: id must be text`);
    assert.ok((fixture.id as string).length > 0, `case ${index}: id must not be empty`);
    assert.ok(!ids.has(fixture.id as string), `duplicate fixture id ${JSON.stringify(fixture.id)}`);
    ids.add(fixture.id as string);
    assert.equal(typeof fixture.source, "string", `${fixture.id}: source must be text`);
    assert.ok(fixture.expect && typeof fixture.expect === "object" && !Array.isArray(fixture.expect), `${fixture.id}: expect must be an object`);

    const expected = fixture.expect as Record<string, unknown>;
    if (expected.outcome === "success") {
      exactKeys(expected, ["outcome", "outputs"], fixture.id as string);
      assert.ok(Array.isArray(expected.outputs), `${fixture.id}: outputs must be an array`);
      for (const output of expected.outputs) {
        assert.ok(
          typeof output === "string" || (typeof output === "number" && Number.isInteger(output)),
          `${fixture.id}: preview-v1 outputs are restricted to text or integers`
        );
      }
    } else if (expected.outcome === "failure") {
      exactKeys(expected, ["outcome", "canonical_error"], fixture.id as string);
      assert.ok(
        expected.canonical_error === "parse" || expected.canonical_error === "evaluation",
        `${fixture.id}: canonical failure category drifted outside preview-v1`
      );
    } else {
      assert.fail(`${fixture.id}: outcome must be success or failure`);
    }

    return fixture as unknown as FixtureCase;
  });
}

const fixtures = loadFixtures();

for (const fixture of fixtures) {
  test(`browser preview conformance: ${fixture.id}`, () => {
    const result = runSolveLangPreview(fixture.source);

    if (fixture.expect.outcome === "success") {
      assert.equal(result.ok, true, `${fixture.id}: expected success`);
      assert.deepEqual(result.values, fixture.expect.outputs, `${fixture.id}: typed output drifted`);
      assert.equal(
        result.output,
        fixture.expect.outputs.map(String).join("\n"),
        `${fixture.id}: visible preview output changed`
      );
      assert.equal(result.error, undefined, `${fixture.id}: success carried an error`);
      return;
    }

    assert.equal(result.ok, false, `${fixture.id}: expected preview rejection`);
    assert.equal(typeof result.error, "string", `${fixture.id}: failure must carry an error`);
    assert.ok(result.error && result.error.length > 0, `${fixture.id}: error must not be empty`);
  });
}
