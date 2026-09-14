import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

async function listen(server) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return server.address().port;
}
async function close(server) { await new Promise((resolve) => server.close(resolve)); }

test("real ImapFlow implicit-TLS client rejects a plaintext loopback endpoint before authentication", async () => {
  let bytes = 0;
  const server = net.createServer((socket) => {
    socket.write("* OK plaintext fixture must never be accepted as TLS\r\n");
    socket.on("data", (chunk) => { bytes += chunk.length; });
  });
  const port = await listen(server);
  const client = new ImapFlow({
    host: "127.0.0.1", port, secure: true,
    auth: { user: "hello@solve.test", pass: "synthetic-only-password" },
    tls: { servername: "mx.solve.test", rejectUnauthorized: true, minVersion: "TLSv1.2" },
    logger: false, emitLogs: false, logRaw: false,
    connectionTimeout: 1000, greetingTimeout: 1000, socketTimeout: 1000,
  });
  client.on("error", () => {});
  try {
    await assert.rejects(() => client.connect());
    assert.equal(client.authenticated, false);
  } finally {
    client.close(); await close(server);
  }
  assert.ok(bytes > 0, "the fixture received a TLS ClientHello rather than IMAP credentials");
});

test("real Nodemailer requireTLS refuses SMTP that does not support STARTTLS and never reaches MAIL/DATA", async () => {
  const commands = [];
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("220 mx.solve.test ESMTP synthetic\r\n");
    let pending = "";
    socket.on("data", (chunk) => {
      pending += chunk;
      while (pending.includes("\r\n")) {
        const index = pending.indexOf("\r\n"), line = pending.slice(0, index); pending = pending.slice(index + 2);
        if (!line) continue;
        commands.push(line);
        if (/^EHLO /i.test(line)) socket.write("250-mx.solve.test\r\n250 AUTH PLAIN\r\n");
        else if (/^STARTTLS$/i.test(line)) socket.write("502 5.5.1 STARTTLS unavailable\r\n");
        else if (/^QUIT$/i.test(line)) { socket.write("221 bye\r\n"); socket.end(); }
        else socket.write("503 5.5.1 bad sequence\r\n");
      }
    });
  });
  const port = await listen(server);
  const transport = nodemailer.createTransport({
    host: "127.0.0.1", port, secure: false, requireTLS: true, ignoreTLS: false, opportunisticTLS: false,
    auth: { user: "hello@solve.test", pass: "synthetic-only-password" },
    connectionTimeout: 1000, greetingTimeout: 1000, socketTimeout: 1000, dnsTimeout: 1000,
    logger: false, debug: false, pool: false,
    tls: { servername: "mx.solve.test", rejectUnauthorized: true, minVersion: "TLSv1.2" },
  });
  try {
    await assert.rejects(() => transport.sendMail({ from: "hello@solve.test", to: "customer@example.test", subject: "Synthetic", text: "Synthetic" }));
  } finally {
    transport.close(); await close(server);
  }
  assert.ok(commands.some((line) => /^STARTTLS$/i.test(line)), `commands: ${commands.join(" | ")}`);
  assert.equal(commands.some((line) => /^(?:MAIL FROM|RCPT TO|DATA)/i.test(line)), false);
});
