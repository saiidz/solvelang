import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const templateUrl = new URL("services/api-access/template.yaml", root);
const redeployUrl = new URL(".github/workflows/deploy-api-access-production-redeploy.yml", root);
const configUrl = new URL("services/api-access/src/config.js", root);

async function text(url) {
  return await readFile(url, "utf8");
}

test("template declares the product binding secret parameter with a blank default", async () => {
  const source = await text(templateUrl);
  assert.match(source, / {2}ProductBindingSecret:\n {4}Type: String\n {4}NoEcho: true\n {4}Default: ""/);
});

test("both board functions receive the product binding secret env", async () => {
  const source = await text(templateUrl);
  const refs = source.match(/PRODUCT_BINDING_SECRET: !Ref ProductBindingSecret/g) ?? [];
  assert.equal(refs.length, 2, "ApiAccessFunction and GitHubFunction both carry the binding secret");
});

test("redeploy workflow sources the binding secret from the production environment", async () => {
  const source = await text(redeployUrl);
  const pattern = new RegExp("PRODUCT_BINDING_SECRET: " + "\\$\\{\\{ secrets\\.PRODUCT_BINDING_SECRET \\}\\}");
  assert.match(source, pattern);
});

test("redeploy workflow passes the binding secret as a SAM parameter override", async () => {
  const source = await text(redeployUrl);
  assert.match(source, /\[\[ -z "\$PRODUCT_BINDING_SECRET" \]\] \|\| parameters\+=\(ProductBindingSecret="\$PRODUCT_BINDING_SECRET"\)/);
});

test("config parses the product connect seam from the same env name", async () => {
  const source = await text(configUrl);
  assert.match(source, /environment\.PRODUCT_BINDING_SECRET/);
});
