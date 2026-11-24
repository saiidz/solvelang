import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Team Context Index billing wiring, held to the same contract shape
// as the runners-ledger seam: the SAM parameters default blank (each
// surface dark until deliberately wired), the env reaches all four
// functions that run src/handler.handler, config.js parses the same
// env names, and handler.js constructs the checkout and the billing
// bridge from them. The redeploy-workflow half of the contract is
// pinned with the workflow change itself.

const root = new URL("../../../", import.meta.url);
const templateUrl = new URL("services/api-access/template.yaml", root);
const configUrl = new URL("services/api-access/src/config.js", root);
const handlerUrl = new URL("services/api-access/src/handler.js", root);
const apiHandlerUrl = new URL("services/api-access/src/api-handler.js", root);

async function text(url) {
  return await readFile(url, "utf8");
}

test("template declares the team context parameters with blank defaults", async () => {
  const source = await text(templateUrl);
  assert.match(source, / {2}StripeTeamContextPriceId:\n {4}Type: String\n {4}Default: ""/);
  assert.match(source, / {2}TeamContextSyncSecret:\n {4}Type: String\n {4}NoEcho: true\n {4}Default: ""/);
  assert.match(source, / {2}TeamContextMcpBaseUrl:\n {4}Type: String\n {4}Default: ""/);
  assert.match(source, / {2}TeamContextMcpBillingToken:\n {4}Type: String\n {4}NoEcho: true\n {4}Default: ""/);
});

test("all four handler functions receive the team context env", async () => {
  const source = await text(templateUrl);
  for (const [envName, ref] of [
    ["STRIPE_TEAM_CONTEXT_PRICE_ID", "StripeTeamContextPriceId"],
    ["TEAM_CONTEXT_SYNC_SECRET", "TeamContextSyncSecret"],
    ["TEAM_CONTEXT_MCP_BASE_URL", "TeamContextMcpBaseUrl"],
    ["TEAM_CONTEXT_MCP_BILLING_TOKEN", "TeamContextMcpBillingToken"],
  ]) {
    const refs = source.match(new RegExp(`${envName}: !Ref ${ref}`, "g")) ?? [];
    assert.equal(refs.length, 4, `${envName} reaches ApiAccessFunction, GitHubFunction, AgentActionsFunction and TeamContextFunction`);
  }
});

test("config parses the team context pointers from the same env names", async () => {
  const source = await text(configUrl);
  assert.match(source, /environment\.STRIPE_TEAM_CONTEXT_PRICE_ID/);
  assert.match(source, /environment\.TEAM_CONTEXT_SYNC_SECRET/);
  assert.match(source, /environment\.TEAM_CONTEXT_MCP_BASE_URL/);
  assert.match(source, /environment\.TEAM_CONTEXT_MCP_BILLING_TOKEN/);
});

test("handler constructs the team checkout and billing bridge inside the billing block", async () => {
  const source = await text(handlerUrl);
  assert.match(source, /createTeamContextCheckoutService\(\{ gateway: stripeGateway, apiAccessService: guardedService, priceId: environment\.teamContext\.priceId, teamContextStore, enabled: true \}\)/);
  assert.match(source, /createTeamContextBillingService\(\{ mcpBaseUrl: environment\.teamContext\.mcpBaseUrl, mcpBillingToken: environment\.teamContext\.mcpBillingToken, gateway: stripeGateway, teamContextStore \}\)/);
  assert.match(source, /createDynamoTeamContextStore\(documentClient, environment\.customerAuthTable\)/);
  assert.match(source, /teamContextSyncSecret: environment\.teamContext\.syncSecret/);
});

test("api handler exposes the team routes and keeps seat sync on its own secret", async () => {
  const source = await text(apiHandlerUrl);
  assert.match(source, /path\.endsWith\("\/customer\/team-context\/teams"\)/);
  assert.match(source, /path\.endsWith\("\/customer\/subscriptions\/team-context\/elements-checkout"\)/);
  assert.match(source, /path\.endsWith\("\/internal\/subscriptions\/team-context\/elements-checkout"\)/);
  assert.match(source, /path\.endsWith\("\/team-context\/seat-sync"\)/);
  assert.match(source, /secureEqual\(header\(event, "x-team-context-sync-secret"\), teamContextSyncSecret\)/);
});
