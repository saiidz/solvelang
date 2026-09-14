import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import test from "node:test";
import nodemailer from "nodemailer";
import { createImapSmtpSupportProvider } from "../src/support-automation-imap-smtp.js";

const input = { accountId: "acct_owner", mailbox: "hello@solve.test", host: "mx.solve.test", folder: "INBOX", credentialSecretArn: "arn:aws:secretsmanager:us-east-2:123456789012:secret:solvelang/support-automation/acct_owner/mail-ABC123" };
const recipient = "sender@customer.test";
const sourceId = createHash("sha256").update(JSON.stringify([input.accountId, input.mailbox, input.host, input.folder])).digest("hex");
const cutover = { sourceId, uidValidity: 7, nextUid: 1 };
const id = `imap:${sourceId}:7:1`;

function certificate() {
  const dir = mkdtempSync(join(tmpdir(), "solvelang-smtp-tls-"));
  const keyPath = join(dir, "key.pem"), certPath = join(dir, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=mx.solve.test", "-addext", "subjectAltName=DNS:mx.solve.test"], { stdio: "ignore" });
  return { key: readFileSync(keyPath), cert: readFileSync(certPath), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
async function listen(server) { await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); return server.address().port; }
async function close(server, sockets) { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); }

function smtpFixture(key, cert, { dropAfterData = false } = {}) {
  const secureContext = tls.createSecureContext({ key, cert }), sockets = new Set();
  const state = { starttls: 0, mail: 0, rcpt: 0, data: 0, messages: 0 };
  const server = net.createServer((plain) => {
    sockets.add(plain); plain.on("close", () => sockets.delete(plain)); plain.setEncoding("utf8"); plain.write("220 mx.solve.test ESMTP synthetic\r\n");
    let buffer = "", inData = false;
    const attach = (stream, secure) => {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        buffer += chunk;
        if (inData) {
          const marker = buffer.indexOf("\r\n.\r\n");
          if (marker < 0) return;
          buffer = buffer.slice(marker + 5); inData = false; state.messages += 1;
          if (dropAfterData) { stream.destroy(); return; }
          stream.write("250 2.0.0 queued\r\n");
        }
        while (!inData && buffer.includes("\r\n")) {
          const end = buffer.indexOf("\r\n"), line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const command = line.split(/\s+/, 1)[0].toUpperCase();
          if (command === "EHLO" || command === "HELO") stream.write(secure ? "250 mx.solve.test\r\n" : "250-mx.solve.test\r\n250 STARTTLS\r\n");
          else if (command === "STARTTLS") {
            state.starttls += 1; stream.write("220 2.0.0 Ready to start TLS\r\n"); stream.removeAllListeners("data");
            const wrapped = new tls.TLSSocket(stream, { isServer: true, secureContext }); sockets.add(wrapped); wrapped.on("close", () => sockets.delete(wrapped)); wrapped.once("secure", () => attach(wrapped, true)); return;
          } else if (command === "MAIL") { state.mail += 1; stream.write("250 2.1.0 sender ok\r\n"); }
          else if (command === "RCPT") { state.rcpt += 1; stream.write("250 2.1.5 recipient ok\r\n"); }
          else if (command === "DATA") { state.data += 1; inData = true; stream.write("354 End data\r\n"); }
          else if (command === "QUIT") { stream.write("221 2.0.0 bye\r\n"); stream.end(); }
          else stream.write("250 2.0.0 ok\r\n");
        }
      });
    };
    attach(plain, false);
  });
  return { server, sockets, state };
}

function provider(port, ca) {
  return createImapSmtpSupportProvider({
    allowedHosts: [input.host], allowSend: true, allowedReplyRecipients: [recipient],
    credentialResolver: async () => ({ username: input.mailbox, password: "synthetic-mailbox-passphrase" }),
    createSmtpTransport: async (options) => nodemailer.createTransport({ ...options, host: "127.0.0.1", port, auth: undefined, tls: { ...options.tls, servername: input.host, ca } }),
  });
}
const reply = { id, cutover, to: recipient, subject: "Re: Synthetic support", text: "Synthetic reply only.", inReplyTo: "<original@customer.test>" };

test("real Nodemailer performs required verified STARTTLS before a controlled SMTP send", async () => {
  const material = certificate(), fixture = smtpFixture(material.key, material.cert), port = await listen(fixture.server);
  try {
    const receipt = await provider(port, material.cert).sendReply(input, reply);
    assert.equal(receipt.acceptedForDelivery, true);
    assert.equal(receipt.delivered, false);
    assert.deepEqual({ starttls: fixture.state.starttls, mail: fixture.state.mail, rcpt: fixture.state.rcpt, data: fixture.state.data, messages: fixture.state.messages }, { starttls: 1, mail: 1, rcpt: 1, data: 1, messages: 1 });
  } finally { await close(fixture.server, fixture.sockets); material.cleanup(); }
});

test("connection loss after DATA remains unknown and is not retried by the adapter", async () => {
  const material = certificate(), fixture = smtpFixture(material.key, material.cert, { dropAfterData: true }), port = await listen(fixture.server);
  try {
    await assert.rejects(() => provider(port, material.cert).sendReply(input, reply), (error) => error.code === "smtp_outcome_unknown");
    assert.equal(fixture.state.starttls, 1);
    assert.equal(fixture.state.data, 1);
    assert.equal(fixture.state.messages, 1);
  } finally { await close(fixture.server, fixture.sockets); material.cleanup(); }
});
