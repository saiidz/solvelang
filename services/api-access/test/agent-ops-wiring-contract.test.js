import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The Level 4 agent-ops gate wiring, held to the same contract
// shape as the Level 3 agent-actions gate: the SAM parameter
// defaults blank, the env reaches the two functions whose handler
// serves /agent/actions (ApiAccessFunction and the
// AgentActionsFunction satellite — both run src/handler.handler,
// whose service refuses the get_ops_digest tool with 503
// agent_ops_disabled unless the flag is exactly "true"), the
// redeploy workflow passes the value through only when one is
// set, config.js parses the same env name, and handler.js wires
// it into the service as opsEnabled. Together these keep every
// production redeploy at the default (off) unless a value is
// deliberately provided — and the same flag is the kill switch
// when it is set back off. The flag is independent of the Level 3
// flag: neither one's wiring may disturb the other's.

const root = new URL("../../../", import.meta.url);
const templateUrl = new URL("services/api-access/template.yaml", root);
const redeployUrl = new URL(".github/workflows/deploy-api-access-production-redeploy.yml", root);
const configUrl = new URL("services/api-access/src/config.js", root);
const handlerUrl = new URL("services/api-access/src/handler.js", root);

async function text(url) {
  return await readFile(url, "utf8");
}

test("template declares the agent-ops parameter with a blank default", async () => {
  const source = await text(templateUrl);
  assert.match(source, / {2}AgentOpsEnabled:\n {4}Type: String\n {4}Default: ""/);
});

test("both functions receive the agent-ops env", async () => {
  const source = await text(templateUrl);
  const refs = source.match(/AGENT_OPS_ENABLED: !Ref AgentOpsEnabled/g) ?? [];
  assert.equal(refs.length, 2, "the agent-ops flag reaches ApiAccessFunction and AgentActionsFunction");
});

test("redeploy workflow sources the agent-ops flag from a variable", async () => {
  const source = await text(redeployUrl);
  const pattern = new RegExp("AGENT_OPS_ENABLED: " + "\\$\\{\\{ vars\\.AGENT_OPS_ENABLED \\}\\}");
  assert.match(source, pattern);
});

test("redeploy workflow passes the agent-ops flag as a SAM parameter override only when set", async () => {
  const source = await text(redeployUrl);
  assert.match(source, /\[\[ -z "\$AGENT_OPS_ENABLED" \]\] \|\| parameters\+=\(AgentOpsEnabled="\$AGENT_OPS_ENABLED"\)/);
});

test("config parses the agent-ops flag from the same env name", async () => {
  const source = await text(configUrl);
  assert.match(source, /environment\.AGENT_OPS_ENABLED/);
  assert.match(source, /agentOpsEnabled/);
});

test("handler wires the parsed flag into the agent-actions service as opsEnabled", async () => {
  const source = await text(handlerUrl);
  assert.match(source, /opsEnabled: environment\.agentOpsEnabled/);
});

test("the Level 3 wiring is undisturbed by the Level 4 plumbing", async () => {
  const source = await text(templateUrl);
  const refs = source.match(/AGENT_ACTIONS_ENABLED: !Ref AgentActionsEnabled/g) ?? [];
  assert.equal(refs.length, 2, "the agent-actions flag still reaches exactly the two functions");
});
