import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

// QA pins for Team Context Index billing on the hosted MCP service:
// the environment names the deployment actually reads, the billing
// routes' auth separation in source, and the public docs carrying
// the billing facts (the docs previously stated there was no billing
// wiring at all — that sentence must never come back).

function resolveFromHere(...urls: string[]): URL {
  for (const url of urls) {
    const candidate = new URL(url, import.meta.url);
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return new URL(urls[0], import.meta.url);
}

const remoteSource = resolveFromHere("../../src/remote.ts", "../src/remote.ts");
const envExample = resolveFromHere("../../deploy/remote.env.example", "../deploy/remote.env.example");
const docs = resolveFromHere(
  "../../../../docs/integrations/team-context-index.md",
  "../../../docs/integrations/team-context-index.md",
);

async function text(url: URL): Promise<string> {
  return await readFile(url, "utf8");
}

test("QA pin: the server resolves the billing token and sync pair from the documented env names", async () => {
  const source = await text(remoteSource);
  assert.match(source, /process\.env\.MCP_REMOTE_BILLING_TOKEN/);
  assert.match(source, /process\.env\.SOLVELANG_TEAM_BILLING_SYNC_URL/);
  assert.match(source, /process\.env\.SOLVELANG_TEAM_BILLING_SYNC_SECRET/);
});

test("QA pin: billing reads accept the billing token only and stay dark without it", async () => {
  const source = await text(remoteSource);
  assert.match(source, /billing_unavailable/);
  assert.match(source, /"\/billing\/teams"/);
  // The billing check is its own gate, separate from isSingleUser.
  assert.match(source, /function isBillingReader/);
});

test("QA pin: the deploy env example documents the billing settings", async () => {
  const source = await text(envExample);
  assert.match(source, /MCP_REMOTE_BILLING_TOKEN/);
  assert.match(source, /SOLVELANG_TEAM_BILLING_SYNC_URL/);
  assert.match(source, /SOLVELANG_TEAM_BILLING_SYNC_SECRET/);
});

test("QA pin: the docs state the seat price and the no-paywall rule", async () => {
  const source = await text(docs);
  assert.match(source, /\$8 per seat per month/);
  assert.match(source, /active members\s+only/);
  assert.match(source, /no paywall/i);
  assert.doesNotMatch(source, /no checkout wiring/);
  assert.doesNotMatch(source, /not a billing surface/);
});
