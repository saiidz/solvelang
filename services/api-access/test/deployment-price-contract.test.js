import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/deploy-api-access.yml", import.meta.url);

test("billing deployment pins the advertised USD monthly prices and products", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  for (const expected of [
    ["4900", "prod_Uyd60j2VJTOrJs"],
    ["19900", "prod_Uyd6jrNL3F0htg"],
    ["69900", "prod_Uyd6EphD1koeJI"],
  ]) {
    assert.ok(workflow.includes(` ${expected[0]} ${expected[1]}`));
  }
  assert.match(workflow, /\.currency == "usd"/);
  assert.match(workflow, /\.unit_amount == \$amount/);
  assert.match(workflow, /\.livemode == false/);
  assert.match(workflow, /\.recurring\.interval == "month"/);
});