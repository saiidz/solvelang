import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import { createImapSmtpSupportProvider } from "../src/support-automation-imap-smtp.js";

// No remote socket: real MIME/parser library exercise with an injected mailbox.
// Full TLS protocol transcripts remain a separate required qualification.
test("pinned libraries load, real MIME is parsed and a reply is serialized without network", async () => {
  const input = { accountId: "acct_fixture", mailbox: "hello@solve.test", host: "mx.solve.test", folder: "INBOX", credentialSecretArn: "arn:aws:secretsmanager:us-east-2:123456789012:secret:solvelang/support-automation/acct_fixture/mail-ABC123" };
  const raw = Buffer.from("From: sender@customer.test\r\nTo: hello@solve.test\r\nSubject: Getting started\r\nMessage-ID: <original@customer.test>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nPlease help us get started.\r\n");
  assert.equal(typeof ImapFlow, "function");
  const sent = [];
  const mailbox = { uidValidity: 7n, uidNext: 10 };
  const provider = createImapSmtpSupportProvider({ allowedHosts: [input.host], allowSend: true, allowedReplyRecipients: ["sender@customer.test"],
    credentialResolver: async () => ({ username: input.mailbox, password: "synthetic-only-password-12345" }),
    createImapClient: async options => {
      // Construct the real client to exercise option compatibility, but never connect it.
      const unused = new ImapFlow(options); unused.on("error", () => {}); unused.close();
      return { mailbox, authenticated: input.mailbox, secureConnection: true, on() {}, async connect() {}, close() {},
        async getMailboxLock() { return { release() {} }; },
        async fetchOne(value) { return { uid: value, size: raw.length }; },
        async download() { return { content: Readable.from([raw]) }; },
      };
    },
    createSmtpTransport: async () => ({ close() {}, async sendMail(message) {
      const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows", disableFileAccess: true, disableUrlAccess: true });
      const rendered = await transport.sendMail(message);
      sent.push(await simpleParser(rendered.message));
      return { accepted: [message.to], rejected: [], response: "250 2.0.0 local-fixture", messageId: rendered.messageId };
    } }),
  });
  const cutover = await provider.captureCutover(input);
  mailbox.uidNext = 11;
  const id = `imap:${cutover.sourceId}:7:10`;
  const message = await provider.readMessage(input, cutover, id);
  assert.equal(message.from, "sender@customer.test");
  assert.match(message.text, /Please help us get started/);
  const receipt = await provider.sendReply(input, { id, cutover, to: message.from, subject: "Re: Getting started", text: "This is a synthetic local reply.", inReplyTo: message.rfcMessageId });
  assert.equal(receipt.delivered, false);
  assert.equal(sent[0].from.value[0].address, input.mailbox);
  assert.equal(sent[0].to.value[0].address, message.from);
  assert.equal(sent[0].inReplyTo, "<original@customer.test>");
  assert.equal(sent[0].headers.get("auto-submitted"), "auto-replied");
});
