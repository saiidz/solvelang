import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Cure pins for the Lambda resource-policy size limit (production
// incident, deploy run 44578395147): Lambda caps a function's
// resource policy at 20,480 bytes, and ApiAccessFunction's policy
// is at that limit — the five Level 3 route permissions failed
// creation with "final policy size (20806) is bigger than the
// limit (20480)" until the agent routes moved to their own
// function. These pins keep them there.

const templateUrl = new URL("../template.yaml", import.meta.url);

const AGENT_EVENTS = {
  AgentTokensList: ["GET", "/customer/agent-tokens"],
  AgentTokensCreate: ["POST", "/customer/agent-tokens"],
  AgentTokensRevoke: ["POST", "/customer/agent-tokens/revoke"],
  AgentPlanPurchasesList: ["GET", "/customer/agent-plan-purchases"],
  AgentPlanPurchasesAction: ["POST", "/customer/agent-plan-purchases"],
};

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

test("Level 3 agent routes live on AgentActionsFunction, never on ApiAccessFunction", async () => {
  const source = await readFile(templateUrl, "utf8");
  const main = resourceBlock(source, "ApiAccessFunction");
  const satellite = resourceBlock(source, "AgentActionsFunction");

  for (const name of Object.keys(AGENT_EVENTS)) {
    assert.equal(main.includes(`        ${name}:`), false, `${name} must not return to ApiAccessFunction (policy size limit)`);
    assert.equal(satellite.includes(`        ${name}:`), true, `${name} lives on AgentActionsFunction`);
  }

  // The Level 2 read-only doorway stays on the main function.
  assert.equal(main.includes("        AgentMcp:"), true, "AgentMcp stays on ApiAccessFunction");

  // The satellite runs the same code through the same handler.
  assert.match(satellite, /Handler: src\/handler\.handler/);
  assert.match(satellite, /Runtime: nodejs22\.x/);
  assert.match(satellite, /AGENT_ACTIONS_ENABLED: !Ref AgentActionsEnabled/);
  assert.match(satellite, /RUNNERS_LEDGER_BASE_URL: !Ref RunnersLedgerBaseUrl/);

  // Each satellite event points at the shared API with the exact
  // path and method the handler dispatches on.
  for (const [name, [method, path]] of Object.entries(AGENT_EVENTS)) {
    const start = satellite.indexOf(`        ${name}:`);
    const eventBlock = satellite.slice(start, start + 400);
    assert.match(eventBlock, /ApiId: !Ref ApiAccessHttpApi/, name);
    assert.ok(eventBlock.includes(`Path: ${path}`), `${name} path`);
    assert.ok(eventBlock.includes(`Method: ${method}`), `${name} method`);
  }

  // The satellite has its own log group.
  assert.match(source, /AgentActionsFunctionLogGroup:/);
  assert.match(source, /LogGroupName: !Sub "\/aws\/lambda\/\$\{AgentActionsFunction\}"/);
});

test("ApiAccessFunction route count stays at the cured ceiling", async () => {
  const source = await readFile(templateUrl, "utf8");
  const main = resourceBlock(source, "ApiAccessFunction");
  const satellite = resourceBlock(source, "AgentActionsFunction");
  // 44 events is the count that fits the 20,480-byte resource
  // policy alongside the Level 2 doorway. Adding a route to
  // ApiAccessFunction requires moving one off first — or putting
  // it on a satellite function like this one.
  assert.equal(eventNames(main).length, 44, "ApiAccessFunction event count is pinned at the policy-safe ceiling");
  assert.equal(eventNames(satellite).length, 5, "AgentActionsFunction carries exactly the five agent routes");
});

test("AgentActionsFunction shares ApiAccessFunction's execution role and declares no policies of its own", async () => {
  const source = await readFile(templateUrl, "utf8");
  const main = resourceBlock(source, "ApiAccessFunction");
  const satellite = resourceBlock(source, "AgentActionsFunction");

  // The deploy identity cannot create NEW IAM roles in the API
  // account: creating the satellite's generated role failed in
  // production (deploy run 44591088243) with a tagging
  // permissions error. So the satellite must never grow a role
  // of its own again - it runs under ApiAccessFunctionRole,
  // whose policy set is exactly the one this function needs
  // (same code, same handler, identical policies by design).
  assert.match(satellite, /Role: !GetAtt ApiAccessFunctionRole\.Arn/);
  assert.equal(
    satellite.includes("      Policies:"),
    false,
    "SAM attaches no policies when Role is set - a Policies block on the satellite would be dead, misleading configuration",
  );
  assert.equal(
    source.includes("AgentActionsFunctionRole"),
    false,
    "the satellite's generated-role logical id must never be referenced into existence",
  );

  // The main function keeps its own generated role and the
  // policies both functions run under.
  assert.equal(main.includes("      Policies:"), true, "ApiAccessFunction keeps its Policies - its generated role is the shared one");
  assert.equal(main.includes("      Role:"), false, "ApiAccessFunction must not point at another function's role");
});
