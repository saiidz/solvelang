import assert from "node:assert/strict";
import test from "node:test";
import { createImapSmtpSupportProvider, IMAP_SUPPORT_LIMITS } from "../src/support-automation-imap-smtp.js";

const input = {
  accountId: "acct_owner",
  mailbox: "hello@solve.test",
  host: "mx.solve.test",
  folder: "INBOX",
  credentialSecretArn: "arn:aws:secretsmanager:us-east-2:123456789012:secret:solvelang/support-automation/acct_owner/mail-ABC123",
};
const startedAt = "2026-09-14T01:00:00.000Z";

function fixture({ uidNext = 105, exists = 4, rows = [] } = {}) {
  const calls = [];
  const mailbox = { uidValidity: 7n, uidNext, exists };
  const provider = createImapSmtpSupportProvider({
    allowedHosts: [input.host],
    credentialResolver: async () => ({ username: input.mailbox, password: "synthetic-only-password-12345" }),
    createImapClient: async () => ({
      mailbox,
      authenticated: input.mailbox,
      secureConnection: true,
      on() {},
      async connect() {},
      close() {},
      async getMailboxLock(_folder, settings) { assert.equal(settings.readOnly, true); return { release() {} }; },
      async *fetch(range, fields, options) {
        calls.push({ range, fields, options });
        for (const row of rows) yield { uid: row.uid, internalDate: new Date(row.receivedAt) };
      },
    }),
  });
  return { provider, calls, mailbox };
}

const firstRows = [
  { uid: 90, receivedAt: "2026-09-14T00:59:50.000Z" },
  { uid: 100, receivedAt: "2026-09-14T01:00:00.100Z" },
  { uid: 101, receivedAt: "2026-09-14T01:00:01.000Z" },
  { uid: 104, receivedAt: "2026-09-14T01:02:00.000Z" },
];

test("durable initialization time includes mail received after activation request even when UIDNEXT snapshot is later", async () => {
  const f = fixture({ uidNext: 105, exists: 4, rows: firstRows });
  const cutover = await f.provider.captureCutover(input, startedAt);
  assert.equal(cutover.uidValidity, 7);
  assert.equal(cutover.nextUid, 100);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].range, "1:4");
  assert.deepEqual(f.calls[0].fields, { uid: true, internalDate: true });
  assert.equal(f.calls[0].options, undefined);
});

test("retry after a crash keeps the same cutover boundary instead of advancing past newly arrived mail", async () => {
  const first = fixture({ uidNext: 105, exists: 4, rows: firstRows });
  const beforeCrash = await first.provider.captureCutover(input, startedAt);
  assert.equal(beforeCrash.nextUid, 100);

  const retryRows = [
    ...firstRows,
    { uid: 105, receivedAt: "2026-09-14T01:03:00.000Z" },
    { uid: 106, receivedAt: "2026-09-14T01:04:00.000Z" },
  ];
  const retry = fixture({ uidNext: 107, exists: 6, rows: retryRows });
  const afterCrash = await retry.provider.captureCutover(input, startedAt);
  assert.equal(afterCrash.nextUid, 100);
  assert.equal(retry.calls[0].range, "1:6");
});

test("messages arriving after the fixed mailbox snapshot cannot move the durable boundary forward", async () => {
  const rows = [...firstRows];
  const f = fixture({ uidNext: 105, exists: 4, rows });
  // The fixture represents an EXISTS/UIDNEXT snapshot of four messages. A later
  // arrival would be sequence 5 / UID 105 and is intentionally outside 1:4.
  rows.push({ uid: 105, receivedAt: "2026-09-14T01:05:00.000Z" });
  const cutover = await f.provider.captureCutover(input, startedAt);
  assert.equal(cutover.nextUid, 100);
  assert.equal(f.calls[0].range, "1:4");
});

test("cutover fails closed when the bounded metadata tail cannot prove where initialization began", async () => {
  const exists = IMAP_SUPPORT_LIMITS.cutoverMetadataWindow + 1;
  const f = fixture({
    uidNext: 1000,
    exists,
    rows: [{ uid: 500, receivedAt: "2026-09-14T01:00:00.001Z" }],
  });
  await assert.rejects(() => f.provider.captureCutover(input, startedAt), (error) => error.code === "imap_cutover_window_exceeded");
  assert.equal(f.calls[0].range, `2:${exists}`);
});

test("invalid durable initialization timestamps fail closed", async () => {
  const f = fixture({ uidNext: 105, exists: 4, rows: firstRows });
  await assert.rejects(() => f.provider.captureCutover(input, "not-a-date"), (error) => error.code === "imap_cutover_time_invalid");
  assert.equal(f.calls.length, 0);
});
