import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const { analyzePreview, inspectTools, MAX_PREVIEW_INPUT } = require("../.studio-test-dist/workflow-preview/components/workflow-preview.js");
for (const mode of ["workflow", "support"]) {
  test(`${mode}: empty/whitespace input cannot be safe, queued, or executable`, () => {
    for (const input of ["", "   \n\t", "hi"]) {
      const result = analyzePreview(input, mode);
      assert.equal(result.status, "needs-details");
      assert.deepEqual(result.actions, []);
      assert.equal(result.draft, ""); assert.equal(result.reply, "");
      assert.equal(result.executionAuthorized, false);
    }
  });
  test(`${mode}: oversized input is rejected, never silently truncated`, () => {
    const result = analyzePreview("a".repeat(MAX_PREVIEW_INPUT + 1) + " delete all records", mode);
    assert.equal(result.status, "too-long");
    assert.deepEqual(result.actions, []); assert.equal(result.draft, "");
  });
}
test("wire transfers and destructive wording get independent review signals", () => {
  for (const input of ["Automatically approve wire transfers.", "Erase all customer records.", "Delete everything once the customer leaves.", "Wipe production database records."]) {
    const result = analyzePreview(input, "workflow");
    assert.ok(result.reviewReasons.length > 1);
    assert.equal(result.executionAuthorized, false);
    assert.equal(result.externallyExecuted, false);
    assert.ok(result.actions.every(action => action.executed === false));
  }
});
test("account risk is not lost behind a bug or billing category", () => {
  for (const input of ["I forgot my password and get an error signing in.", "A billing error exposed my account credentials."]) {
    const result = analyzePreview(input, "support");
    assert.equal(result.category, "Account or security");
    assert.ok(result.reviewReasons.includes("Account, identity or security action"));
    assert.equal(result.suggestedOwner, "Account/security support");
  }
});
test("download and explicit non-urgency do not become urgent by substring", () => {
  assert.equal(analyzePreview("How do I download the guide?", "support").urgency, "not-determined");
  assert.equal(analyzePreview("This is not urgent. Please share the guide.", "support").urgency, "not-determined");
  assert.equal(analyzePreview("The service is down and we are blocked.", "support").urgency, "urgent");
});
test("generic email never invents Gmail and explicit Outlook/Jira are retained", () => {
  const result = analyzePreview("When an Outlook email arrives, create a task in Jira.", "workflow");
  assert.deepEqual(result.tools, ["Outlook", "Jira"]);
  assert.equal(inspectTools("An email arrives.").includes("Gmail"), false);
  assert.ok(inspectTools("An email arrives.").includes("Email (provider unspecified)"));
});
test("an output email does not override the form trigger", () => {
  const result = analyzePreview("When a form submission arrives, draft an email reply in Outlook.", "workflow");
  assert.equal(result.trigger, "New form submission");
  assert.equal(analyzePreview("Use Gmail to send the weekly report.", "workflow").trigger, "Trigger not specified");
});
test("different requested actions produce different print-only planning scripts", () => {
  const reply = analyzePreview("When an email arrives, draft a reply.", "workflow");
  const complex = analyzePreview("When an email arrives, delete the records, create a task in Linear, and notify the Slack channel.", "workflow");
  assert.notEqual(reply.draft, complex.draft);
  assert.ok(reply.actions.some(action => action.id === "draft"));
  assert.ok(complex.actions.some(action => action.id === "destructive-review"));
  assert.ok(complex.actions.some(action => action.id === "task"));
  assert.ok(complex.actions.some(action => action.id === "notify"));
  assert.doesNotMatch(complex.draft, /execute permitted actions|^on incoming|^workflow /m);
});
test("unrecognized or non-English input never certifies safe automation", () => {
  for (const input of ["Please handle this unknown process for us.", "supprimer toutes les informations du client", "امسح جميع معلومات العميل الآن"]) {
    const result = analyzePreview(input, "workflow");
    assert.equal(result.executionAuthorized, false);
    assert.match(result.reviewReasons.join(" "), /Risk is not verified/);
    assert.doesNotMatch(JSON.stringify(result), /Safe to automate|queued|Triage complete/);
  }
});
test("reply drafts do not claim a real specialist or investigation already exists", () => {
  for (const input of ["There is a billing error on the invoice.", "The app crashes on startup.", "I need help with my account password."]) {
    const result = analyzePreview(input, "support");
    assert.ok(result.reply.length);
    assert.doesNotMatch(result.reply, /is reviewing|validating the issue now|will reply shortly|already assigned/i);
    assert.equal(result.externallyExecuted, false);
  }
});
test("generated script does not interpolate user-controlled executable material", () => {
  const result = analyzePreview('When an email arrives, draft a reply. "); http_get("https://malicious.invalid"); print("', "workflow");
  assert.doesNotMatch(result.draft, /malicious|http_get/);
  for (const line of result.draft.split("\n")) assert.match(line, /^(?:\/\/|let (?:trigger|workflow_type|review_required) = |print\()/);
});
test("short sensitive requests still show review flags but no actions or generated draft", () => {
  const result = analyzePreview("Refund", "support");
  assert.equal(result.status, "needs-details");
  assert.ok(result.reviewReasons.includes("Financial or payment action"));
  assert.equal(result.draft, ""); assert.deepEqual(result.actions, []);
});
