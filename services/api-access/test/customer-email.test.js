import assert from "node:assert/strict";
import test from "node:test";
import { createCustomerEmailGateway } from "../src/customer-email.js";

function recordingGateway() {
  const sent = [];
  const gateway = createCustomerEmailGateway(
    { send: async (command) => sent.push(command) },
    { sender: "security@solve-lang.com", replyTo: "support@solve-lang.com" },
  );
  return { gateway, sent };
}

test("security notice emails the account with change-specific copy and delivery envelope", async () => {
  const { gateway, sent } = recordingGateway();
  await gateway.sendSecurityNotice({ email: "dev@example.com", change: "password_changed" });
  assert.equal(sent.length, 1);
  const input = sent[0].input;
  assert.equal(input.FromEmailAddress, "security@solve-lang.com");
  assert.deepEqual(input.ReplyToAddresses, ["support@solve-lang.com"]);
  assert.deepEqual(input.Destination.ToAddresses, ["dev@example.com"]);
  assert.match(input.Content.Simple.Subject.Data, /password was changed/i);
  assert.match(input.Content.Simple.Body.Text.Data, /If it was not/i);
  assert.match(input.Content.Simple.Body.Html.Data, /password was changed/i);
});

test("security notice covers authenticator and backup-code changes without a sign-in link", async () => {
  const { gateway, sent } = recordingGateway();
  for (const change of ["authenticator_enabled", "authenticator_disabled", "backup_codes_regenerated"]) {
    await gateway.sendSecurityNotice({ email: "dev@example.com", change });
  }
  assert.equal(sent.length, 3);
  const subjects = sent.map((command) => command.input.Content.Simple.Subject.Data);
  assert.match(subjects[0], /enabled/i);
  assert.match(subjects[1], /disabled/i);
  assert.match(subjects[2], /backup codes/i);
  for (const command of sent) {
    assert.doesNotMatch(command.input.Content.Simple.Body.Text.Data, /magic_token|Sign in to your SolveLang API account:/);
  }
});
