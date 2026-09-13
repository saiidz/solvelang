import assert from "node:assert/strict";
import test from "node:test";
import { createGmailSupportProvider } from "../src/support-automation-providers.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("Gmail reply MIME identifies the configured mailbox as From", async () => {
  let request;
  const provider = createGmailSupportProvider({
    credentialResolver: async () => ({ accessToken: "gmail-access-token-1234567890" }),
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return jsonResponse({ id: "sent_1", threadId: "thread_1" });
    },
  });

  await provider.sendReply({
    credentialSecretArn: "secret:gmail",
    mailbox: "support@example.com",
    threadId: "thread_1",
    to: "customer@example.com",
    subject: "Re: Need help",
    text: "Thanks.",
    inReplyTo: "<m1@example.com>",
  });

  const payload = JSON.parse(request.options.body);
  const decoded = Buffer.from(payload.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  assert.match(decoded, /^From: support@example\.com\r\n/m);
  assert.match(decoded, /\r\nTo: customer@example\.com\r\n/);
  assert.match(decoded, /\r\nMIME-Version: 1\.0\r\n/);
  assert.match(decoded, /\r\nIn-Reply-To: <m1@example\.com>\r\n/);
});
