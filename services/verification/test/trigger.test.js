// QA pins for the `/solvelang verify` trigger parsing (Slice 2).
// The command is an act: only a created comment, only on a pull
// request, only when a whole line is exactly the command.
import assert from "node:assert/strict";
import test from "node:test";

import { isVerifyCommand, parseIssueCommentTrigger } from "../src/trigger.js";

test("the command matches a whole line, case-insensitively", () => {
  assert.equal(isVerifyCommand("/solvelang verify"), true);
  assert.equal(isVerifyCommand("  /SolveLang Verify  "), true);
  assert.equal(isVerifyCommand("please re-check\n/solvelang verify\nthanks"), true);
});

test("a mentioned or quoted command does not fire", () => {
  assert.equal(isVerifyCommand("can you run /solvelang verify for me?"), false);
  assert.equal(isVerifyCommand("`/solvelang verify`"), false);
  assert.equal(isVerifyCommand("/solvelang verify now"), false);
  assert.equal(isVerifyCommand(""), false);
  assert.equal(isVerifyCommand(null), false);
  assert.equal(isVerifyCommand(undefined), false);
});

function payload(overrides = {}) {
  return {
    action: "created",
    issue: { number: 15, pull_request: { url: "https://api.github.com/x" } },
    comment: { id: 99, body: "/solvelang verify" },
    repository: { name: "solvelang-verification-proof", owner: { login: "saiidz" } },
    installation: { id: 186232390 },
    ...overrides,
  };
}

test("a created PR comment with the command parses to a trigger", () => {
  const trigger = parseIssueCommentTrigger(payload());
  assert.deepEqual(trigger, {
    owner: "saiidz",
    repo: "solvelang-verification-proof",
    prNumber: 15,
    installationId: 186232390,
    commentId: 99,
  });
});

test("edits, plain issues, and non-commands never trigger", () => {
  assert.equal(parseIssueCommentTrigger(payload({ action: "edited" })), null);
  assert.equal(
    parseIssueCommentTrigger(payload({ issue: { number: 3 } })),
    null
  );
  assert.equal(
    parseIssueCommentTrigger(payload({ comment: { id: 1, body: "looks good" } })),
    null
  );
  assert.equal(parseIssueCommentTrigger(null), null);
  assert.equal(parseIssueCommentTrigger({}), null);
});
