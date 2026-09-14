import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createImapSmtpSupportProvider, IMAP_SUPPORT_LIMITS } from "../src/support-automation-imap-smtp.js";

const input = Object.freeze({ accountId: "acct_owner", mailbox: "hello@solve.test", host: "mx.solve.test", folder: "INBOX", credentialSecretArn: "arn:aws:secretsmanager:us-east-2:123456789012:secret:solvelang/support-automation/acct_owner/mail-ABC123" });
function fixture(options = {}) {
  const calls = { credentials: 0, imap: [], smtp: [], locks: [], closed: 0, fetch: [], read: [], sent: [] };
  const parsed = { from: { value: [{ address: "sender@customer.test" }] }, to: { value: [{ address: input.mailbox }] }, subject: "A support question", text: "Please help with the app setup.", messageId: "<test1@customer.test>", attachments: [], headers: new Map() };
  const state = { uidValidity: 42n, uidNext: 101, ...options.state };
  const provider = createImapSmtpSupportProvider({
    allowedHosts: [input.host], allowedReplyRecipients: ["sender@customer.test"], allowSend: options.allowSend ?? true,
    deadlineMs: options.deadlineMs ?? 15000,
    credentialResolver: options.credentialResolver || (async () => { calls.credentials++; return { username: input.mailbox, password: "synthetic-only-password-12345", ...options.secret }; }),
    createImapClient: async config => {
      calls.imap.push(config);
      return {
        mailbox: state, authenticated: options.authenticated ?? input.mailbox, secureConnection: options.secureConnection ?? true,
        on() {}, async connect() {}, close() { calls.closed++; },
        async getMailboxLock(folder, settings) { calls.locks.push({ folder, ...settings }); return { release() {} }; },
        async *fetch(range, fields, settings) {
          calls.fetch.push({ range, fields, settings });
          for (const value of options.uids ?? [101, 103]) yield { uid: value };
        },
        async fetchOne(value, fields, settings) { calls.read.push({ value, fields, settings }); return { uid: value, size: options.size ?? 7, internalDate: new Date("2026-09-13T12:00:00Z") }; },
        async download(value, part, settings) { calls.read.push({ value, part, settings }); return { content: Readable.from(options.chunks ?? [Buffer.from("fixture")]) }; },
      };
    },
    parseMessage: async (_, settings) => { assert.equal(settings.skipHtmlToText, true); return { ...parsed, ...options.parsed }; },
    createSmtpTransport: async config => {
      calls.smtp.push(config);
      return { close() { calls.closed++; }, async sendMail(message) {
        calls.sent.push(message);
        if (options.sendError) throw new Error("DO_NOT_LEAK_provider_credential");
        return { accepted: [message.to], rejected: [], messageId: message.messageId, response: "250 2.0.0 accepted", ...options.receipt };
      } };
    },
  });
  return { provider, calls, parsed, state };
}
async function ready(options) {
  const f = fixture(options);
  f.cutover = await f.provider.captureCutover(input);
  f.state.uidNext = 105;
  f.id = `imap:${f.cutover.sourceId}:42:101`;
  return f;
}

test("capture uses read-only TLS login and records UIDNEXT without reading historical mail", async () => {
  const { provider, calls } = fixture();
  const baseline = await provider.captureCutover(input);
  assert.equal(baseline.nextUid, 101); assert.equal(baseline.uidValidity, 42);
  assert.equal(calls.fetch.length, 0); assert.equal(calls.read.length, 0);
  assert.equal(calls.locks[0].readOnly, true); assert.equal(calls.closed, 1);
  const config = calls.imap[0]; assert.equal(config.port, 993); assert.equal(config.secure, true);
  assert.deepEqual(config.tls, { servername: input.host, rejectUnauthorized: true, minVersion: "TLSv1.2" });
  assert.equal(config.logger, false); assert.equal(config.logRaw, false); assert.equal(config.disableCompression, true);
});
test("deny unknown host and cross-tenant secret before secret resolution or network", async () => {
  const { provider, calls } = fixture();
  for (const patch of [{ host: "attacker.test" }, { host: "127.0.0.1" }, { credentialSecretArn: input.credentialSecretArn.replace("acct_owner", "acct_other") }, { accountId: "../escape" }, { folder: "INBOX\r\nA1 LOGIN" }]) await assert.rejects(provider.captureCutover({ ...input, ...patch }));
  assert.equal(calls.credentials, 0); assert.equal(calls.imap.length, 0);
});
test("empty deployment allowlist forbids any credential or network use", async () => {
  const provider = createImapSmtpSupportProvider({ credentialResolver: async () => { throw new Error("must not run"); } });
  await assert.rejects(provider.captureCutover(input), /mailbox_host_not_approved/);
});
test("credential username must bind to the selected mailbox; secret fields cannot override TLS or host", async () => {
  const bad = fixture({ secret: { username: "another@solve.test" } });
  await assert.rejects(bad.provider.captureCutover(input), /mailbox_credential_invalid/); assert.equal(bad.calls.imap.length, 0);
  const f = fixture({ secret: { host: "attacker.test", authzid: "admin", tls: { rejectUnauthorized: false } } });
  await f.provider.captureCutover(input);
  assert.equal(f.calls.imap[0].host, input.host); assert.equal(f.calls.imap[0].auth.authzid, undefined); assert.equal(f.calls.imap[0].tls.rejectUnauthorized, true);
});
test("IMAP PREAUTH or mismatched identity is not accepted as mailbox authentication", async () => {
  for (const options of [{ authenticated: true }, { authenticated: "other@solve.test" }, { secureConnection: false }]) {
    const f = fixture(options); await assert.rejects(f.provider.captureCutover(input), /imap_authenticated_identity_mismatch/);
    assert.equal(f.calls.locks.length, 0);
  }
});
test("old unread messages are excluded by immutable cutover, not the Seen flag or a date filter", async () => {
  const f = await ready(); const batch = await f.provider.scanNew(input, f.cutover);
  assert.equal(batch.nextCursor, 105); assert.equal(batch.messages.length, 2);
  assert.deepEqual(f.calls.fetch[0], { range: "101:104", fields: { uid: true }, settings: { uid: true } });
  await assert.rejects(f.provider.scanNew(input, f.cutover, 100), /imap_cursor_before_cutover/);
  await assert.rejects(f.provider.readMessage(input, f.cutover, f.id.replace(/101$/, "100")), /imap_message_identity_invalid/);
});
test("missing cutover and a cutover from another folder fail closed", async () => {
  const f = await ready();
  await assert.rejects(f.provider.scanNew(input, undefined), /imap_cutover_required/);
  await assert.rejects(f.provider.scanNew({ ...input, folder: "Archive" }, f.cutover), /imap_cutover_required/);
});
test("UIDVALIDITY changes do not reset the cursor or reread the mailbox", async () => {
  const f = await ready(); f.state.uidValidity = 99n;
  await assert.rejects(f.provider.scanNew(input, f.cutover), /imap_uidvalidity_changed/);
  await assert.rejects(f.provider.readMessage(input, f.cutover, f.id), /imap_uidvalidity_changed/);
  assert.equal(f.calls.fetch.length, 0); assert.equal(f.calls.read.length, 0);
});
test("no-new-message scan does not create reversed IMAP ranges", async () => {
  const f = await ready(); f.state.uidNext = 101;
  assert.deepEqual(await f.provider.scanNew(input, f.cutover), { messages: [], nextCursor: 101 });
  assert.equal(f.calls.fetch.length, 0);
});
test("UID window is bounded despite a large inbox and gaps", async () => {
  const f = await ready({ uids: [] }); f.state.uidNext = 10000000;
  const result = await f.provider.scanNew(input, f.cutover);
  assert.equal(result.nextCursor, 101 + IMAP_SUPPORT_LIMITS.uidWindow);
  assert.equal(f.calls.fetch[0].range, "101:150");
});
test("out-of-range and duplicate server responses fail closed", async () => {
  for (const uids of [[100], [99999], [101, 101]]) {
    const f = await ready({ uids }); await assert.rejects(f.provider.scanNew(input, f.cutover), /imap_scan_response_invalid/);
  }
});
test("read uses UID, bounded streaming and EXAMINE without setting Seen", async () => {
  const f = await ready(); const message = await f.provider.readMessage(input, f.cutover, f.id);
  assert.equal(message.from, "sender@customer.test"); assert.equal(message.id, f.id);
  assert.equal(f.calls.read[1].settings.maxBytes, IMAP_SUPPORT_LIMITS.wireBytes + 1);
  assert.equal(f.calls.locks.at(-1).readOnly, true);
});
test("metadata oversize, truncated stream and overlong actual stream fail before parsing", async () => {
  for (const options of [{ size: 999999 }, { chunks: [Buffer.from("cut")] }, { chunks: [Buffer.alloc(IMAP_SUPPORT_LIMITS.wireBytes + 1)] }]) {
    const f = await ready(options); await assert.rejects(f.provider.readMessage(input, f.cutover, f.id), /imap_message_(?:too_large|incomplete)/);
  }
});
test("HTML-only, attachments, oversized decoded text require review", async () => {
  for (const parsed of [{ text: "" }, { attachments: [{}] }, { text: "x".repeat(IMAP_SUPPORT_LIMITS.textBytes + 1) }]) {
    const f = await ready({ parsed }); await assert.rejects(f.provider.readMessage(input, f.cutover, f.id), /mail_content_requires_review/);
  }
});
test("auto responders, lists, own mail, wrong recipient and alternate reply identities are not auto-replied", async () => {
  const variants = [
    { headers: new Map([["auto-submitted", "auto-replied"]]) }, { headers: new Map([["list-id", "list.example"]]) },
    { headers: new Map([["return-path", "<>"]]) }, { from: { value: [{ address: input.mailbox }] } },
    { to: { value: [{ address: "other@solve.test" }] } }, { replyTo: { value: [{ address: "thirdparty@other.test" }] } },
  ];
  for (const parsed of variants) { const f = await ready({ parsed }); await assert.rejects(f.provider.readMessage(input, f.cutover, f.id)); }
});
function reply(f, patch = {}) { return { id: f.id, cutover: f.cutover, to: "sender@customer.test", subject: "Re: A support question", text: "Synthetic reply", inReplyTo: "<test1@customer.test>", ...patch }; }
test("SMTP requires explicit send gate and exact recipient allowlist before credentials", async () => {
  const f = await ready({ allowSend: false }); const before = f.calls.credentials;
  await assert.rejects(f.provider.sendReply(input, reply(f)), /smtp_reply_not_authorized/); assert.equal(f.calls.credentials, before);
  const g = await ready(); await assert.rejects(g.provider.sendReply(input, reply(g, { to: "victim@elsewhere.test" })), /smtp_reply_not_authorized/);
  assert.equal(g.calls.smtp.length, 0);
});
test("SMTP forces verified STARTTLS, bound From and a single recipient; receipt means accepted, not delivered", async () => {
  const f = await ready(); const result = await f.provider.sendReply(input, reply(f));
  assert.equal(result.acceptedForDelivery, true); assert.equal(result.delivered, false);
  const config = f.calls.smtp[0]; assert.equal(config.port, 587); assert.equal(config.requireTLS, true); assert.equal(config.ignoreTLS, false); assert.equal(config.opportunisticTLS, false);
  assert.equal(config.tls.rejectUnauthorized, true); assert.equal(config.disableFileAccess, true); assert.equal(config.disableUrlAccess, true);
  assert.deepEqual(f.calls.sent[0].envelope, { from: input.mailbox, to: ["sender@customer.test"] });
  assert.equal(f.calls.sent[0].headers["Auto-Submitted"], "auto-replied"); assert.equal(f.calls.sent[0].from, input.mailbox);
});
test("SMTP rejects header injection and arbitrary message objects", async () => {
  const f = await ready();
  for (const patch of [{ subject: "Hi\r\nBcc: x@y.test" }, { inReplyTo: "<id@a.test>\r\nExtra" }, { text: { path: "/etc/passwd" } }, { to: "x@y.test,person@evil.test" }]) await assert.rejects(f.provider.sendReply(input, reply(f, patch)));
  assert.equal(f.calls.smtp.length, 0);
});
test("missing/ambiguous SMTP receipt never retries and does not leak provider errors", async () => {
  for (const options of [{ sendError: true }, { receipt: { accepted: [] } }, { receipt: { response: "354 continue" } }, { receipt: { rejected: ["x@y.test"] } }]) {
    const f = await ready(options); await assert.rejects(f.provider.sendReply(input, reply(f)), error => error.code === "smtp_outcome_unknown" && !error.message.includes("DO_NOT_LEAK"));
    assert.equal(f.calls.sent.length, 1);
  }
});
test("timeout during secret resolution never starts a late IMAP connection", async () => {
  const f = fixture({ deadlineMs: 10, credentialResolver: async () => { await new Promise(resolve => setTimeout(resolve, 30)); return { username: input.mailbox, password: "synthetic-only-password-12345" }; } });
  await assert.rejects(f.provider.captureCutover(input), /imap_operation_timeout/);
  await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(f.calls.imap.length, 0);
});
