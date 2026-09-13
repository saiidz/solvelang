import assert from "node:assert/strict";
import test from "node:test";
import { createGmailSupportProvider, createLinearSupportProvider } from "../src/support-automation-providers.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const gmailSecret = "secret:gmail";
const linearSecret = "secret:linear";

function header(name, value) { return { name, value }; }
function encode(text) { return Buffer.from(text).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }

test("Gmail adapter uses bounded unread/profile/full-message APIs and parses source identity", async () => {
  const calls = [];
  const provider = createGmailSupportProvider({
    credentialResolver: async (ref) => { assert.equal(ref, gmailSecret); return { accessToken: "gmail-access-token-1234567890" }; },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      assert.equal(options.redirect, "error");
      assert.match(options.headers.authorization, /^Bearer /);
      if (String(url).endsWith("/profile")) return jsonResponse({ emailAddress: "support@example.com" });
      if (String(url).includes("messages?")) return jsonResponse({ messages: [{ id: "m1", threadId: "t1" }] });
      return jsonResponse({
        id: "m1", threadId: "t1", internalDate: "1789336800000",
        payload: { mimeType: "multipart/alternative", headers: [header("From", "Customer <customer@example.com>"), header("To", "support@example.com"), header("Subject", "Need help"), header("Message-ID", "<m1@example.com>")], parts: [{ mimeType: "text/plain", body: { data: encode("Please help with setup") } }] },
      });
    },
  });
  assert.deepEqual(await provider.getProfile({ credentialSecretArn: gmailSecret, mailbox: "support@example.com" }), { emailAddress: "support@example.com" });
  assert.deepEqual(await provider.listUnread({ credentialSecretArn: gmailSecret, mailbox: "support@example.com", limit: 5 }), [{ id: "m1", threadId: "t1" }]);
  const message = await provider.getMessage({ credentialSecretArn: gmailSecret, mailbox: "support@example.com", id: "m1" });
  assert.equal(message.from, "customer@example.com"); assert.equal(message.to, "support@example.com"); assert.equal(message.text, "Please help with setup");
  assert.ok(calls.some((call) => call.url.includes("q=is%3Aunread") && call.url.includes("maxResults=5")));
  assert.ok(calls.some((call) => call.url.endsWith("messages/m1?format=full")));
});

test("Gmail send adapter emits an RFC822 reply through the configured mailbox without redirects", async () => {
  let request;
  const provider = createGmailSupportProvider({
    credentialResolver: async () => ({ accessToken: "gmail-access-token-1234567890" }),
    fetchImpl: async (url, options) => { request = { url: String(url), options }; return jsonResponse({ id: "sent_1", threadId: "thread_1" }); },
  });
  const outcome = await provider.sendReply({ credentialSecretArn: gmailSecret, mailbox: "support@example.com", threadId: "thread_1", to: "customer@example.com", subject: "Re: Need help", text: "Thanks.", inReplyTo: "<m1@example.com>" });
  assert.deepEqual(outcome, { id: "sent_1", threadId: "thread_1" });
  assert.equal(request.url, "https://gmail.googleapis.com/gmail/v1/users/support%40example.com/messages/send");
  const payload = JSON.parse(request.options.body);
  const decoded = Buffer.from(payload.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  assert.match(decoded, /To: customer@example\.com/); assert.match(decoded, /In-Reply-To: <m1@example\.com>/); assert.match(decoded, /Thanks\./);
});

test("Linear adapter sends the real issueCreate GraphQL contract and returns provider outcome", async () => {
  let request;
  const provider = createLinearSupportProvider({
    credentialResolver: async (ref) => { assert.equal(ref, linearSecret); return { apiKey: "lin_api_12345678901234567890" }; },
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return jsonResponse({ data: { issueCreate: { success: true, issue: { id: "issue_1", url: "https://linear.app/acme/issue/ABC-1", identifier: "ABC-1" } } } });
    },
  });
  const outcome = await provider.createIssue({ credentialSecretArn: linearSecret, teamId: "team_1", title: "[normal] Need help", description: "Support request" });
  assert.equal(request.url, "https://api.linear.app/graphql"); assert.equal(request.options.redirect, "error");
  assert.equal(request.options.headers.authorization, "lin_api_12345678901234567890");
  const body = JSON.parse(request.options.body);
  assert.match(body.query, /issueCreate/); assert.equal(body.variables.input.teamId, "team_1");
  assert.equal(outcome.identifier, "ABC-1");
});

test("provider adapters reject non-2xx and malformed acknowledgements instead of claiming success", async () => {
  const gmail = createGmailSupportProvider({ credentialResolver: async () => ({ accessToken: "gmail-access-token-1234567890" }), fetchImpl: async () => jsonResponse({ error: "bad" }, 500) });
  await assert.rejects(() => gmail.getProfile({ credentialSecretArn: gmailSecret, mailbox: "support@example.com" }));
  const linear = createLinearSupportProvider({ credentialResolver: async () => ({ apiKey: "lin_api_12345678901234567890" }), fetchImpl: async () => jsonResponse({ data: { issueCreate: { success: false } } }) });
  await assert.rejects(() => linear.createIssue({ credentialSecretArn: linearSecret, teamId: "team", title: "x", description: "y" }));
});
