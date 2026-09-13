import assert from "node:assert/strict";
import test from "node:test";
import { createSupportAutomationService, supportAutomationInternals } from "../src/support-automation.js";

const ACCOUNT_ID = `acct_${"a".repeat(32)}`;
const baseConfig = {
  provider: "gmail",
  inboxEmail: "support@example.com",
  gmailCredentialSecretArn: `arn:aws:secretsmanager:us-east-1:123456789012:secret:solvelang/support-automation/${ACCOUNT_ID}/gmail-AbCd`,
  taskProvider: "linear",
  linearCredentialSecretArn: `arn:aws:secretsmanager:us-east-1:123456789012:secret:solvelang/support-automation/${ACCOUNT_ID}/linear-EfGh`,
  linearTeamId: "team_test",
  allowedActions: ["create_linear_issue", "send_reply"],
};

test("configuration accepts only an explicitly supported policy version", () => {
  const accepted = supportAutomationInternals.normalizeConfiguration(ACCOUNT_ID, { ...baseConfig, policyVersion: "support-v1" }, Date.parse("2026-09-13T22:00:00Z"));
  assert.equal(accepted.policyVersion, "support-v1");
  assert.throws(
    () => supportAutomationInternals.normalizeConfiguration(ACCOUNT_ID, { ...baseConfig, policyVersion: "future-v2" }, Date.parse("2026-09-13T22:00:00Z")),
    (error) => error.code === "unsupported_support_automation_policy_version",
  );
});

test("classification is tied to the stored policy version and fails closed for unknown versions", () => {
  const classification = supportAutomationInternals.classify({ subject: "App error", text: "It crashes on startup." }, "support-v1");
  assert.equal(classification.policyVersion, "support-v1");
  assert.equal(classification.category, "product_support");
  assert.throws(
    () => supportAutomationInternals.classify({ subject: "Hello", text: "Need help" }, "retired-v0"),
    (error) => error.code === "unsupported_support_automation_policy_version",
  );
});

test("customer history exposes review reasons and policy version without raw message content", async () => {
  const store = {
    async listEvents(accountId) {
      assert.equal(accountId, ACCOUNT_ID);
      return [{
        eventId: "gmail:m1",
        state: "REVIEW_REQUIRED",
        category: "billing",
        urgency: "normal",
        requiresReview: true,
        sensitiveReasons: ["financial"],
        policyVersion: "support-v1",
        actions: [],
        createdAt: "2026-09-13T22:00:00.000Z",
        updatedAt: "2026-09-13T22:00:01.000Z",
        providerMessageHash: "abc123",
        rawBody: "refund my secret card data",
      }];
    },
  };
  const service = createSupportAutomationService({ store, gmail: {}, linear: {} });
  const history = await service.history({ accountId: ACCOUNT_ID });
  assert.deepEqual(history[0].sensitiveReasons, ["financial"]);
  assert.equal(history[0].policyVersion, "support-v1");
  assert.equal(JSON.stringify(history).includes("refund my secret"), false);
});

test("a stale stored configuration with an unknown policy cannot be resumed", async () => {
  let stateMutationCalled = false;
  const store = {
    async getConfig(accountId) {
      assert.equal(accountId, ACCOUNT_ID);
      return { accountId, automationState: "PAUSED", revision: 4, policyVersion: "retired-v0" };
    },
    async setState() { stateMutationCalled = true; throw new Error("must not run"); },
  };
  const service = createSupportAutomationService({ store, gmail: {}, linear: {}, activationEnabled: true });
  await assert.rejects(
    () => service.resume({ accountId: ACCOUNT_ID }),
    (error) => error.code === "unsupported_support_automation_policy_version",
  );
  assert.equal(stateMutationCalled, false);
});
