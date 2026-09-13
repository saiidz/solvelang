import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { ApiAccessError } from "./service.js";

function timeoutSignal(milliseconds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function fetchJson(fetchImpl, url, options, label) {
  const timeout = timeoutSignal(8_000);
  try {
    const response = await fetchImpl(url, { ...options, redirect: "error", signal: timeout.signal });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
    if (!response.ok) throw new Error(`${label} request failed with ${response.status}.`);
    return body;
  } finally { timeout.clear(); }
}

function base64UrlDecode(value) {
  if (typeof value !== "string" || !value) return "";
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function base64UrlEncode(value) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function header(payload, name) {
  return payload?.headers?.find((entry) => String(entry?.name).toLowerCase() === name.toLowerCase())?.value ?? "";
}

function plainText(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) return base64UrlDecode(payload.body.data);
  for (const part of payload.parts ?? []) {
    const text = plainText(part);
    if (text) return text;
  }
  if (payload.body?.data) return base64UrlDecode(payload.body.data);
  return "";
}

function cleanAddress(value) {
  const match = String(value ?? "").match(/<([^>]+)>/);
  const email = (match?.[1] ?? String(value ?? "")).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Provider message address is invalid.");
  return email;
}

export function createSecretsManagerCredentialResolver(client) {
  if (!client?.send) throw new Error("Secrets Manager client is required.");
  return async function resolve(secretArn) {
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn, VersionStage: "AWSCURRENT" }));
    const secret = typeof response.SecretString === "string"
      ? response.SecretString
      : response.SecretBinary ? Buffer.from(response.SecretBinary).toString("utf8") : "";
    if (!secret) throw new Error("Credential secret is empty.");
    let parsed;
    try { parsed = JSON.parse(secret); } catch { throw new Error("Credential secret must contain JSON."); }
    return parsed;
  };
}

export function createGmailSupportProvider({ credentialResolver, fetchImpl = fetch }) {
  if (typeof credentialResolver !== "function" || typeof fetchImpl !== "function") throw new Error("Gmail provider dependencies are required.");
  async function token(secretArn) {
    const secret = await credentialResolver(secretArn);
    if (typeof secret.accessToken !== "string" || secret.accessToken.length < 20) throw new Error("Gmail credential secret is invalid.");
    return secret.accessToken;
  }
  async function request(secretArn, path, options = {}) {
    const accessToken = await token(secretArn);
    return fetchJson(fetchImpl, `https://gmail.googleapis.com/gmail/v1${path}`, {
      ...options,
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...(options.headers ?? {}) },
    }, "Gmail");
  }
  return {
    async getProfile({ credentialSecretArn, mailbox }) {
      return request(credentialSecretArn, `/users/${encodeURIComponent(mailbox)}/profile`, { method: "GET" });
    },
    async listUnread({ credentialSecretArn, mailbox, limit = 5 }) {
      const query = new URLSearchParams({ q: "is:unread", maxResults: String(Math.min(Math.max(limit, 1), 20)) });
      const body = await request(credentialSecretArn, `/users/${encodeURIComponent(mailbox)}/messages?${query}`, { method: "GET" });
      return Array.isArray(body.messages) ? body.messages.filter((entry) => typeof entry?.id === "string").slice(0, limit) : [];
    },
    async getMessage({ credentialSecretArn, mailbox, id }) {
      const body = await request(credentialSecretArn, `/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(id)}?format=full`, { method: "GET" });
      return {
        id: body.id,
        threadId: body.threadId,
        rfcMessageId: header(body.payload, "Message-ID"),
        from: cleanAddress(header(body.payload, "From")),
        to: cleanAddress(header(body.payload, "To") || mailbox),
        subject: header(body.payload, "Subject") || "Support request",
        text: plainText(body.payload),
        receivedAt: body.internalDate ? new Date(Number(body.internalDate)).toISOString() : undefined,
      };
    },
    async sendReply({ credentialSecretArn, mailbox, threadId, to, subject, text, inReplyTo }) {
      const headers = [`To: ${cleanAddress(to)}`, `Subject: ${String(subject).replace(/[\r\n]/g, " ")}`, "Content-Type: text/plain; charset=utf-8"];
      if (inReplyTo) headers.push(`In-Reply-To: ${String(inReplyTo).replace(/[\r\n]/g, " ")}`, `References: ${String(inReplyTo).replace(/[\r\n]/g, " ")}`);
      const raw = base64UrlEncode(`${headers.join("\r\n")}\r\n\r\n${text}`);
      const body = await request(credentialSecretArn, `/users/${encodeURIComponent(mailbox)}/messages/send`, { method: "POST", body: JSON.stringify({ raw, threadId }) });
      if (typeof body.id !== "string" || !body.id) throw new Error("Gmail send did not return a message ID.");
      return { id: body.id, threadId: body.threadId ?? threadId };
    },
  };
}

export function createLinearSupportProvider({ credentialResolver, fetchImpl = fetch }) {
  if (typeof credentialResolver !== "function" || typeof fetchImpl !== "function") throw new Error("Linear provider dependencies are required.");
  return {
    async createIssue({ credentialSecretArn, teamId, title, description }) {
      const secret = await credentialResolver(credentialSecretArn);
      if (typeof secret.apiKey !== "string" || secret.apiKey.length < 20) throw new Error("Linear credential secret is invalid.");
      const body = await fetchJson(fetchImpl, "https://api.linear.app/graphql", {
        method: "POST",
        headers: { authorization: secret.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          query: "mutation SupportIssue($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id url identifier } } }",
          variables: { input: { teamId, title: String(title).slice(0, 240), description: String(description).slice(0, 8_000) } },
        }),
      }, "Linear");
      if (body.errors?.length || !body.data?.issueCreate?.success || !body.data?.issueCreate?.issue?.id) throw new Error("Linear issue creation was not acknowledged.");
      const issue = body.data.issueCreate.issue;
      return { id: issue.id, url: issue.url, identifier: issue.identifier };
    },
  };
}

export function providerFailureAsApiError(error) {
  if (error instanceof ApiAccessError) return error;
  return new ApiAccessError(503, "support_automation_provider_unavailable", "A support automation provider is unavailable.");
}
