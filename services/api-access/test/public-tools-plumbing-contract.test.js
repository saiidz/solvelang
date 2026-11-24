import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// QA pins for the public-tools plumbing (free repo security scan +
// CI bill check): the two new public routes must live on the
// PublicToolsFunction satellite - never on ApiAccessFunction, whose
// resource policy is at the 20,480-byte ceiling (44 events pinned
// by agent-actions-template.test.js) - and the kill-switch flags
// must be plumbed end to end: GitHub environment variable ->
// redeploy workflow parameter -> SAM parameter -> function env.

const templateUrl = new URL("../template.yaml", import.meta.url);
const workflowUrl = new URL("../../../.github/workflows/deploy-api-access-production-redeploy.yml", import.meta.url);

function resourceBlock(source, name) {
  const start = source.indexOf(`\n  ${name}:`);
  assert.notEqual(start, -1, `${name} exists in the template`);
  const rest = source.slice(start + 1);
  const next = rest.slice(name.length + 3).search(/\n  [A-Z][A-Za-z0-9]+:/);
  return next === -1 ? rest : rest.slice(0, name.length + 3 + next);
}

function eventNames(block) {
  const eventsSection = block.slice(block.indexOf("      Events:"));
  return [...eventsSection.matchAll(/^        ([A-Za-z0-9]+):$/gm)].map((match) => match[1]);
}

const PUBLIC_EVENTS = {
  PublicRepoSecurityScan: ["POST", "/public/repo-security-scan"],
  PublicCiBillCheck: ["POST", "/public/ci-bill-check"],
};

test("public tool routes live on PublicToolsFunction, never on ApiAccessFunction", async () => {
  const source = await readFile(templateUrl, "utf8");
  const main = resourceBlock(source, "ApiAccessFunction");
  const satellite = resourceBlock(source, "PublicToolsFunction");

  assert.deepEqual(eventNames(satellite).sort(), Object.keys(PUBLIC_EVENTS).sort());
  assert.equal(eventNames(main).length, 44, "ApiAccessFunction stays at the cured 44-event ceiling");

  for (const [name, [method, path]] of Object.entries(PUBLIC_EVENTS)) {
    assert.equal(main.includes(`        ${name}:`), false, `${name} must not sit on ApiAccessFunction (policy size limit)`);
    const start = satellite.indexOf(`        ${name}:`);
    const eventBlock = satellite.slice(start, start + 400);
    assert.match(eventBlock, /ApiId: !Ref ApiAccessHttpApi/, name);
    assert.ok(eventBlock.includes(`Path: ${path}`), `${name} path`);
    assert.ok(eventBlock.includes(`Method: ${method}`), `${name} method`);
  }

  // Same code, same handler, shared execution role, no own policies.
  assert.match(satellite, /Handler: src\/handler\.handler/);
  assert.match(satellite, /Runtime: nodejs22\.x/);
  assert.match(satellite, /Role: !GetAtt ApiAccessFunctionRole\.Arn/);
  assert.equal(satellite.includes("      Policies:"), false, "satellite declares no policies of its own");
  assert.equal(source.includes("PublicToolsFunctionRole"), false, "the satellite's generated-role logical id must never be referenced into existence");

  // Own log group.
  assert.match(source, /PublicToolsFunctionLogGroup:/);
  assert.match(source, /LogGroupName: !Sub "\/aws\/lambda\/\$\{PublicToolsFunction\}"/);
});

test("kill-switch flags are plumbed from SAM parameter to satellite env", async () => {
  const source = await readFile(templateUrl, "utf8");
  const satellite = resourceBlock(source, "PublicToolsFunction");

  for (const [parameter, envName] of [["SecurityScanEnabled", "SECURITY_SCAN_ENABLED"], ["CiBillCheckEnabled", "CI_BILL_CHECK_ENABLED"]]) {
    const paramBlock = resourceBlock(source, parameter);
    assert.match(paramBlock, /Type: String/);
    assert.match(paramBlock, /Default: ""/, `${parameter} defaults blank (disabled)`);
    assert.ok(satellite.includes(`${envName}: !Ref ${parameter}`), `${envName} wired from ${parameter}`);
  }

  // The main function does not carry the flags: the routes are not
  // on it, so its env stays untouched.
  const main = resourceBlock(source, "ApiAccessFunction");
  assert.equal(main.includes("SECURITY_SCAN_ENABLED"), false);
  assert.equal(main.includes("CI_BILL_CHECK_ENABLED"), false);
});

test("redeploy workflow passes both GitHub variables through as SAM parameters", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  assert.ok(workflow.includes("SECURITY_SCAN_ENABLED: ${{ vars.SECURITY_SCAN_ENABLED }}"));
  assert.ok(workflow.includes("CI_BILL_CHECK_ENABLED: ${{ vars.CI_BILL_CHECK_ENABLED }}"));
  assert.ok(workflow.includes('parameters+=(SecurityScanEnabled="$SECURITY_SCAN_ENABLED")'));
  assert.ok(workflow.includes('parameters+=(CiBillCheckEnabled="$CI_BILL_CHECK_ENABLED")'));
});
