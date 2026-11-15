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

test("template declares the runners-ledger parameters with blank defaults", async () => {
  const source = await text(templateUrl);
  assert.match(source, / {2}RunnersLedgerBaseUrl:\n {4}Type: String\n {4}Default: ""/);
  assert.match(source, / {2}RunnersLedgerAdminToken:\n {4}Type: String\n {4}NoEcho: true\n {4}Default: ""/);
});

test("both board functions receive the runners-ledger env pair", async () => {
  const source = await text(templateUrl);
  const baseUrls = source.match(/RUNNERS_LEDGER_BASE_URL: !Ref RunnersLedgerBaseUrl/g) ?? [];
  const tokens = source.match(/RUNNERS_LEDGER_ADMIN_TOKEN: !Ref RunnersLedgerAdminToken/g) ?? [];
  assert.equal(baseUrls.length, 2, "ApiAccessFunction and GitHubFunction both carry the base URL");
  assert.equal(tokens.length, 2, "ApiAccessFunction and GitHubFunction both carry the admin token");
});

test("redeploy workflow sources the pair from the production environment", async () => {
  const source = await text(redeployUrl);
  assert.match(source, /RUNNERS_LEDGER_BASE_URL: \$\{\{ vars\.RUNNERS_LEDGER_BASE_URL \}\}/);
  assert.match(source, /RUNNERS_LEDGER_ADMIN_TOKEN: \$\{\{ secrets\.RUNNERS_LEDGER_ADMIN_TOKEN \}\}/);
});

test("redeploy workflow passes the pair as SAM parameter overrides", async () => {
  const source = await text(redeployUrl);
  assert.match(source, /RunnersLedgerBaseUrl="\$RUNNERS_LEDGER_BASE_URL"/);
  assert.match(source, /RunnersLedgerAdminToken="\$RUNNERS_LEDGER_ADMIN_TOKEN"/);
});

test("config parses the minutes seam from the same env names", async () => {
  const source = await text(configUrl);
  assert.match(source, /environment\.RUNNERS_LEDGER_BASE_URL/);
  assert.match(source, /environment\.RUNNERS_LEDGER_ADMIN_TOKEN/);
});
