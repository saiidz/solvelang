import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The AG-UI pilot's gate wiring, held to the same contract shape as
// the product binding secret: the SAM parameter defaults blank, the
// env reaches ApiAccessFunction (and only ApiAccessFunction — the
// route lives in the customer API handler), the redeploy workflow
// passes the value through only when one is set, and config.js parses
// the same env name. Together these keep every production redeploy
// at the default (off) unless a value is deliberately provided.

const root = new URL("../../../", import.meta.url);
const templateUrl = new URL("services/api-access/template.yaml", root);
const redeployUrl = new URL(".github/workflows/deploy-api-access-production-redeploy.yml", root);
const configUrl = new URL("services/api-access/src/config.js", root);

async function text(url) {
  return await readFile(url, "utf8");
}

test("template declares the AG-UI pilot parameter with a blank default", async () => {
  const source = await text(templateUrl);
  assert.match(source, / {2}AgUiPilotEnabled:\n {4}Type: String\n {4}Default: ""/);
});

test("only ApiAccessFunction receives the AG-UI pilot env", async () => {
  const source = await text(templateUrl);
  const refs = source.match(/AG_UI_PILOT_ENABLED: !Ref AgUiPilotEnabled/g) ?? [];
  assert.equal(refs.length, 1, "the pilot flag reaches exactly one function");
});

test("redeploy workflow sources the AG-UI pilot flag from a variable", async () => {
  const source = await text(redeployUrl);
  const pattern = new RegExp("AG_UI_PILOT_ENABLED: " + "\\$\\{\\{ vars\\.AG_UI_PILOT_ENABLED \\}\\}");
  assert.match(source, pattern);
});

test("redeploy workflow passes the AG-UI pilot flag as a SAM parameter override only when set", async () => {
  const source = await text(redeployUrl);
  assert.match(source, /\[\[ -z "\$AG_UI_PILOT_ENABLED" \]\] \|\| parameters\+=\(AgUiPilotEnabled="\$AG_UI_PILOT_ENABLED"\)/);
});

test("config parses the AG-UI pilot flag from the same env name", async () => {
  const source = await text(configUrl);
  assert.match(source, /environment\.AG_UI_PILOT_ENABLED/);
});
