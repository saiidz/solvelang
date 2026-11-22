import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The Level 3 agent-actions gate wiring, held to the same contract
// shape as the agent talk-back gate: the SAM parameter defaults
// blank, the env reaches the two functions whose handler serves the
// gated surfaces (ApiAccessFunction and the AgentActionsFunction
// satellite — both run src/handler.handler, which refuses with 503
// agent_actions_disabled unless the flag is exactly "true"), the
// redeploy workflow passes the value through only when one is set,
// and config.js parses the same env name. Together these keep every
// production redeploy at the default (off) unless a value is
// deliberately provided — and the same flag is the kill switch when
// it is set back off.

const root = new URL("../../../", import.meta.url);
const templateUrl = new URL("services/api-access/template.yaml", root);
const redeployUrl = new URL(".github/workflows/deploy-api-access-production-redeploy.yml", root);
const configUrl = new URL("services/api-access/src/config.js", root);

async function text(url) {
  return await readFile(url, "utf8");
}

test("template declares the agent-actions parameter with a blank default", async () => {
  const source = await text(templateUrl);
  assert.match(source, / {2}AgentActionsEnabled:\n {4}Type: String\n {4}Default: ""/);
});

test("both agent-actions functions receive the agent-actions env", async () => {
  const source = await text(templateUrl);
  const refs = source.match(/AGENT_ACTIONS_ENABLED: !Ref AgentActionsEnabled/g) ?? [];
  assert.equal(refs.length, 2, "the agent-actions flag reaches ApiAccessFunction and AgentActionsFunction");
});

test("redeploy workflow sources the agent-actions flag from a variable", async () => {
  const source = await text(redeployUrl);
  const pattern = new RegExp("AGENT_ACTIONS_ENABLED: " + "\\$\\{\\{ vars\\.AGENT_ACTIONS_ENABLED \\}\\}");
  assert.match(source, pattern);
});

test("redeploy workflow passes the agent-actions flag as a SAM parameter override only when set", async () => {
  const source = await text(redeployUrl);
  assert.match(source, /\[\[ -z "\$AGENT_ACTIONS_ENABLED" \]\] \|\| parameters\+=\(AgentActionsEnabled="\$AGENT_ACTIONS_ENABLED"\)/);
});

test("config parses the agent-actions flag from the same env name", async () => {
  const source = await text(configUrl);
  assert.match(source, /environment\.AGENT_ACTIONS_ENABLED/);
});
