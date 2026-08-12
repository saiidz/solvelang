import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const templateUrl = new URL("../template.yaml", import.meta.url);

async function template() {
  return await readFile(templateUrl, "utf8");
}

test("template permits reviewed live customer accounts with required auth controls", async () => {
  const source = await template();
  assert.match(source, /CustomerAccountsRequirements:/);
  assert.match(source, /Customer accounts require API access to be enabled\./);
  assert.match(source, /Customer accounts require a separate authentication pepper\./);
  assert.match(source, /Customer accounts require a verified SES sender\./);
  assert.doesNotMatch(source, /CustomerAccountsRemainTestOnly:/);
  assert.doesNotMatch(source, /Customer accounts are test-mode only until production review is complete\./);
});

test("template keeps subscription billing test-only", async () => {
  const source = await template();
  assert.match(source, /SubscriptionBillingRemainsTestOnly:/);
  assert.match(source, /Subscription billing requires API access to be enabled\./);
  assert.match(source, /Browser subscription billing requires customer accounts to be enabled\./);
  assert.match(source, /Subscription billing is test-mode only until production review is complete\./);
  assert.match(source, /StripeSecretKey:/);
  assert.match(source, /StripeSubscriptionWebhookSecret:/);
});
