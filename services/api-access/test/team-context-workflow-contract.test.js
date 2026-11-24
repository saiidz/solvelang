import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The redeploy-workflow half of the Team Context Index billing
// wiring contract (the template/config/handler half is pinned in
// team-context-wiring-contract.test.js): the production redeploy
// sources the price + MCP base URL from environment variables and
// the two secrets from environment secrets, guards the production
// values exactly like the Merge Governance pointers, and passes all
// four as SAM parameter overrides so every redeploy carries them.

const root = new URL("../../../", import.meta.url);
const redeployUrl = new URL(".github/workflows/deploy-api-access-production-redeploy.yml", root);

async function text(url) {
  return await readFile(url, "utf8");
}

test("redeploy workflow sources the team context values from the production environment", async () => {
  const source = await text(redeployUrl);
  assert.match(source, /STRIPE_TEAM_CONTEXT_PRICE_ID: \$\{\{ vars\.STRIPE_TEAM_CONTEXT_PRICE_ID \}\}/);
  assert.match(source, /TEAM_CONTEXT_MCP_BASE_URL: \$\{\{ vars\.TEAM_CONTEXT_MCP_BASE_URL \}\}/);
  assert.match(source, /TEAM_CONTEXT_SYNC_SECRET: \$\{\{ secrets\.TEAM_CONTEXT_SYNC_SECRET \}\}/);
  assert.match(source, /TEAM_CONTEXT_MCP_BILLING_TOKEN: \$\{\{ secrets\.TEAM_CONTEXT_MCP_BILLING_TOKEN \}\}/);
});

test("redeploy workflow guards the production team context values", async () => {
  const source = await text(redeployUrl);
  assert.match(source, /\[\[ "\$STRIPE_TEAM_CONTEXT_PRICE_ID" == "price_1UfNfH4HWc7PvaDYymqk6lre" \]\]/);
  assert.match(source, /\[\[ "\$TEAM_CONTEXT_MCP_BASE_URL" == "https:\/\/mcp\.solve-lang\.com" \]\]/);
  assert.match(source, /\(\( \$\{#TEAM_CONTEXT_SYNC_SECRET\} >= 32 \)\)/);
  assert.match(source, /\(\( \$\{#TEAM_CONTEXT_MCP_BILLING_TOKEN\} >= 32 \)\)/);
});

test("redeploy workflow passes the team context values as SAM parameter overrides", async () => {
  const source = await text(redeployUrl);
  assert.match(source, /StripeTeamContextPriceId="\$STRIPE_TEAM_CONTEXT_PRICE_ID"/);
  assert.match(source, /TeamContextSyncSecret="\$TEAM_CONTEXT_SYNC_SECRET"/);
  assert.match(source, /TeamContextMcpBaseUrl="\$TEAM_CONTEXT_MCP_BASE_URL"/);
  assert.match(source, /TeamContextMcpBillingToken="\$TEAM_CONTEXT_MCP_BILLING_TOKEN"/);
});
