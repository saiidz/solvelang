import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The agent talk-back gate wiring, held to the same contract shape as
// the AG-UI pilot gate: the SAM parameter defaults blank, the env
// reaches ApiAccessFunction (and only ApiAccessFunction — the route
// lives in the API handler), the redeploy workflow passes the value
// through only when one is set, and config.js parses the same env
// name. Together these keep every production redeploy at the default
// (off) unless a value is deliberately provided — and the same flag
// is the kill switch when it is set back off.

const root = new URL("../../../", import.meta.url);
const templateUrl = new URL("services/api-access/template.yaml", root);
const redeployUrl = new URL(".github/workflows/deploy-api-access-production-redeploy.yml", root);
const configUrl = new URL("services/api-access/src/config.js", root);

async function text(url) {
  return await readFile(url, "utf8");
}

test("template declares the agent talk-back parameter with a blank default", async () => {
  const source = await text(templateUrl);
  assert.match(source, / {2}AgentTalkbackEnabled:\n {4}Type: String\n {4}Default: ""/);
});

test("only ApiAccessFunction receives the agent talk-back env", async () => {
  const source = await text(templateUrl);
  const refs = source.match(/AGENT_TALKBACK_ENABLED: !Ref AgentTalkbackEnabled/g) ?? [];
  assert.equal(refs.length, 1, "the talk-back flag reaches exactly one function");
});

test("redeploy workflow sources the agent talk-back flag from a variable", async () => {
  const source = await text(redeployUrl);
  const pattern = new RegExp("AGENT_TALKBACK_ENABLED: " + "\\$\\{\\{ vars\\.AGENT_TALKBACK_ENABLED \\}\\}");
  assert.match(source, pattern);
});

test("redeploy workflow passes the agent talk-back flag as a SAM parameter override only when set", async () => {
  const source = await text(redeployUrl);
  assert.match(source, /\[\[ -z "\$AGENT_TALKBACK_ENABLED" \]\] \|\| parameters\+=\(AgentTalkbackEnabled="\$AGENT_TALKBACK_ENABLED"\)/);
});

test("config parses the agent talk-back flag from the same env name", async () => {
  const source = await text(configUrl);
  assert.match(source, /environment\.AGENT_TALKBACK_ENABLED/);
});
