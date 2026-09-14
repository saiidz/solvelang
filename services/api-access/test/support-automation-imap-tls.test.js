import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import test from "node:test";
import { ImapFlow } from "imapflow";
import { createImapSmtpSupportProvider } from "../src/support-automation-imap-smtp.js";

const input = {
  accountId: "acct_owner",
  mailbox: "hello@solve.test",
  host: "mx.solve.test",
  folder: "INBOX",
  credentialSecretArn: "arn:aws:secretsmanager:us-east-2:123456789012:secret:solvelang/support-automation/acct_owner/mail-ABC123",
};

function ephemeralCertificate() {
  const dir = mkdtempSync(join(tmpdir(), "solvelang-mail-tls-"));
  const keyPath = join(dir, "key.pem"), certPath = join(dir, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=mx.solve.test", "-addext", "subjectAltName=DNS:mx.solve.test"], { stdio: "ignore" });
  return { key: readFileSync(keyPath), cert: readFileSync(certPath), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function listen(server) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return server.address().port;
}
async function close(server, sockets) {
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
}

function imapTlsFixture(key, cert) {
  const commands = [], sockets = new Set();
  const server = tls.createServer({ key, cert }, (socket) => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.setEncoding("utf8");
    socket.write("* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR] synthetic ready\r\n");
    let pending = "", authTag;
    socket.on("data", (chunk) => {
      pending += chunk;
      while (pending.includes("\r\n")) {
        const boundary = pending.indexOf("\r\n"), line = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
        if (!line) continue;
        commands.push(line);
        if (authTag) {
          const decoded = Buffer.from(line, "base64").toString("utf8");
          assert.equal(decoded, `\u0000${input.mailbox}\u0000synthetic-only-password-12345`);
          socket.write(`${authTag} OK AUTHENTICATE completed\r\n`); authTag = undefined; continue;
        }
        const parsed = /^(\S+)\s+([A-Z]+)(?:\s+(.*))?$/i.exec(line);
        if (!parsed) continue;
        const [, tag, command, rest = ""] = parsed;
        switch (command.toUpperCase()) {
          case "CAPABILITY": socket.write(`* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR\r\n${tag} OK CAPABILITY completed\r\n`); break;
          case "AUTHENTICATE": {
            const encoded = rest.split(/\s+/)[1];
            if (encoded) {
              const decoded = Buffer.from(encoded, "base64").toString("utf8");
              assert.equal(decoded, `\u0000${input.mailbox}\u0000synthetic-only-password-12345`);
              socket.write(`${tag} OK AUTHENTICATE completed\r\n`);
            } else { authTag = tag; socket.write("+ \r\n"); }
            break;
          }
          case "LOGIN": socket.write(`${tag} OK LOGIN completed\r\n`); break;
          case "LIST": socket.write(`* LIST (\\HasNoChildren) "/" "INBOX"\r\n${tag} OK LIST completed\r\n`); break;
          case "EXAMINE": socket.write(`* FLAGS (\\Seen \\Answered \\Flagged \\Deleted \\Draft)\r\n* 0 EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 7] valid\r\n* OK [UIDNEXT 10] next\r\n* OK [PERMANENTFLAGS ()] read only\r\n${tag} OK [READ-ONLY] EXAMINE completed\r\n`); break;
          case "LOGOUT": socket.write(`* BYE logout\r\n${tag} OK LOGOUT completed\r\n`); socket.end(); break;
          default: socket.write(`${tag} OK ${command} completed\r\n`); break;
        }
      }
    });
  });
  server.on("tlsClientError", () => {});
  return { server, sockets, commands };
}

function providerAt(port, ca) {
  return createImapSmtpSupportProvider({
    allowedHosts: [input.host],
    credentialResolver: async () => ({ username: input.mailbox, password: "synthetic-only-password-12345" }),
    createImapClient: async (options) => new ImapFlow({
      ...options,
      host: "127.0.0.1",
      port,
      tls: { ...options.tls, servername: input.host, ...(ca ? { ca } : {}) },
    }),
  });
}

test("real ImapFlow proves hostname-verified implicit TLS, authentication and read-only cutover through the adapter", async () => {
  const material = ephemeralCertificate(), fixture = imapTlsFixture(material.key, material.cert), port = await listen(fixture.server);
  try {
    const cutover = await providerAt(port, material.cert).captureCutover(input);
    assert.equal(cutover.uidValidity, 7);
    assert.equal(cutover.nextUid, 10);
    assert.match(cutover.sourceId, /^[a-f0-9]{64}$/);
    assert.ok(fixture.commands.some((line) => /\b(?:AUTHENTICATE|LOGIN)\b/i.test(line)), fixture.commands.join(" | "));
    assert.ok(fixture.commands.some((line) => /\bEXAMINE\b/i.test(line)), fixture.commands.join(" | "));
  } finally { await close(fixture.server, fixture.sockets); material.cleanup(); }
});

test("real ImapFlow rejects an untrusted certificate before any IMAP authentication command", async () => {
  const material = ephemeralCertificate(), fixture = imapTlsFixture(material.key, material.cert), port = await listen(fixture.server);
  try {
    await assert.rejects(() => providerAt(port).captureCutover(input), (error) => error.code === "imap_operation_failed");
    assert.equal(fixture.commands.some((line) => /\b(?:AUTHENTICATE|LOGIN)\b/i.test(line)), false, fixture.commands.join(" | "));
  } finally { await close(fixture.server, fixture.sockets); material.cleanup(); }
});
