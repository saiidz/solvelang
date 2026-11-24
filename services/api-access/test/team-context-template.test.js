import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Team Context Index routes live on their own satellite function:
// ApiAccessFunction's resource policy is at the 20,480-byte Lambda
// ceiling and its event count is pinned at 44 (see
// agent-actions-template.test.js), so - exactly like the Level 3
// agent routes - the team routes ride a same-code satellite under
// the shared execution role. These pins keep them there.

const templateUrl = new URL("../template.yaml", import.meta.url);

const TEAM_EVENTS = {
  TeamContextTeamsList: ["GET", "/customer/team-context/teams"],
  TeamContextCustomerCheckout: ["POST", "/customer/subscriptions/team-context/elements-checkout"],
  TeamContextInternalCheckout: ["POST", "/internal/subscriptions/team-context/elements-checkout"],
  TeamContextSeatSync: ["POST", "/team-context/seat-sync"],
};

function resourceBlock(source, name) {
  const start = source.indexOf(`\n  ${name}:`);
  assert.notEqual(start, -1, `${name} exists in the template`);
  const rest = source.slice(start + 1);
  const next = rest.slice(name.length + 3).search(/\n  [A-Z][A-Za-z0-9]+:/);
  return next === -1 ? rest : rest.slice(0, name.length + 3 + next);
}

test("team routes live on TeamContextFunction, never on ApiAccessFunction", async () => {
  const source = await readFile(templateUrl, "utf8");
  const main = resourceBlock(source, "ApiAccessFunction");
  const satellite = resourceBlock(source, "TeamContextFunction");

  for (const name of Object.keys(TEAM_EVENTS)) {
    assert.equal(main.includes(`        ${name}:`), false, `${name} must not sit on ApiAccessFunction (policy size limit)`);
    assert.equal(satellite.includes(`        ${name}:`), true, `${name} lives on TeamContextFunction`);
  }

  assert.match(satellite, /Handler: src\/handler\.handler/);
  assert.match(satellite, /Runtime: nodejs22\.x/);
  assert.match(satellite, /Role: !GetAtt ApiAccessFunctionRole\.Arn/);
  assert.equal(satellite.includes("      Policies:"), false, "the satellite declares no policies of its own");
  assert.match(satellite, /STRIPE_TEAM_CONTEXT_PRICE_ID: !Ref StripeTeamContextPriceId/);
  assert.match(satellite, /TEAM_CONTEXT_SYNC_SECRET: !Ref TeamContextSyncSecret/);
  assert.match(satellite, /TEAM_CONTEXT_MCP_BASE_URL: !Ref TeamContextMcpBaseUrl/);
  assert.match(satellite, /TEAM_CONTEXT_MCP_BILLING_TOKEN: !Ref TeamContextMcpBillingToken/);

  for (const [name, [method, path]] of Object.entries(TEAM_EVENTS)) {
    const start = satellite.indexOf(`        ${name}:`);
    const eventBlock = satellite.slice(start, start + 400);
    assert.match(eventBlock, /ApiId: !Ref ApiAccessHttpApi/, name);
    assert.ok(eventBlock.includes(`Path: ${path}`), `${name} path`);
    assert.ok(eventBlock.includes(`Method: ${method}`), `${name} method`);
  }

  assert.match(source, /TeamContextFunctionLogGroup:/);
  assert.match(source, /LogGroupName: !Sub "\/aws\/lambda\/\$\{TeamContextFunction\}"/);
});
