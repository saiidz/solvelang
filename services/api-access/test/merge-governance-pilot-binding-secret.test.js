import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/deploy-merge-governance-pilot.yml", import.meta.url);
async function workflow() { return await readFile(workflowUrl, "utf8"); }

test("pilot dispatcher reads the binding-state secret from an environment secret", async () => {
  const source = await workflow();
  assert.match(source, /MGOV_BINDING_STATE_SECRET: \$\{\{ secrets\.MGOV_BINDING_STATE_SECRET \}\}/);
});

test("binding-state secret is passed as the BindingStateSecret parameter only when set", async () => {
  const source = await workflow();
  assert.match(source, /\[\[ -z "\$MGOV_BINDING_STATE_SECRET" \]\] \|\| parameters\+=\(BindingStateSecret="\$MGOV_BINDING_STATE_SECRET"\)/);
});

test("the parameter name matches the pilot template's BindingStateSecret", async () => {
  const source = await workflow();
  // The private pilot template declares the `BindingStateSecret`
  // parameter and wires it to the function env BINDING_STATE_SECRET;
  // the dispatcher's conditional override must use that exact name.
  assert.match(source, /parameters\+=\(BindingStateSecret="\$MGOV_BINDING_STATE_SECRET"\)/);
  assert.match(source, /BINDING_STATE_SECRET/);
});

test("binding-state secret is never passed empty - not in the unconditional parameter list", async () => {
  const source = await workflow();
  // It is not part of the unconditional parameter list the deploy starts
  // from, so an unset secret leaves the parameter (and the template
  // default that fails closed) untouched.
  assert.doesNotMatch(source, /parameters=\(\s*PilotTenantId="\$PILOT_TENANT_ID"\s*PilotRepos="\$PILOT_REPOS"\s*AdminToken="\$MGOV_ADMIN_TOKEN"\s*WebhookSecret="\$MGOV_WEBHOOK_SECRET"\s*BindingStateSecret/);
});

test("deployment summary reports the binding state secret state", async () => {
  const source = await workflow();
  assert.match(source, /binding_state_line="not configured"/);
  assert.match(source, /\[\[ -z "\$MGOV_BINDING_STATE_SECRET" \]\] \|\| binding_state_line="configured \(parameter passed\)"/);
  assert.match(source, /echo "- Binding state secret: \*\*\$binding_state_line\*\*"/);
});
