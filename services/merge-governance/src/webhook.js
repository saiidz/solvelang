// GitHub webhook ingress for the merge-governance pilot.
//
// POST /webhooks/github
//   - WEBHOOK_SECRET unset        -> 503 (fail closed)
//   - missing/invalid signature   -> 401
//   - valid delivery              -> enqueue on SQS FIFO, return 202
//
// Idempotency: the SQS message deduplication id is the GitHub delivery
// id (x-github-delivery), so redeliveries collapse in the FIFO queue.
// The ingress only authenticates and enqueues; all state changes happen
// in the worker (src/worker.js) where they are decision-logged.

import { createHmac, timingSafeEqual } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

export function verifyWebhookSignature(secret, rawBody, signatureHeader) {
  if (!secret || !signatureHeader || typeof signatureHeader !== "string") {
    return false;
  }
  if (!signatureHeader.startsWith("sha256=")) return false;
  const expected =
    "sha256=" +
    createHmac("sha256", secret).update(rawBody || "", "utf8").digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function headerValue(headers, name) {
  if (!headers) return "";
  return headers[name] || headers[name.toLowerCase()] || "";
}

// sqsSend is injectable for tests:
//   async ({ queueUrl, body, deduplicationId, groupId })
export function createWebhookHandler({ config, sqsSend }) {
  return async function handleWebhook(event) {
    if (!config.webhookSecret) {
      return json(503, { error: "webhook_not_configured" });
    }
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : event.body || "";
    const signature = headerValue(event.headers, "x-hub-signature-256");
    if (!verifyWebhookSignature(config.webhookSecret, rawBody, signature)) {
      return json(401, { error: "invalid_signature" });
    }
    let payload;
    try {
      payload = JSON.parse(rawBody || "{}");
    } catch {
      return json(400, { error: "invalid_json" });
    }
    const deliveryId = headerValue(event.headers, "x-github-delivery");
    const eventName = headerValue(event.headers, "x-github-event");
    const pr = payload.pull_request
      ? {
          number: payload.pull_request.number,
          headSha: payload.pull_request.head?.sha ?? null,
          merged: Boolean(payload.pull_request.merged),
        }
      : null;
    const message = {
      tenantId: config.pilotTenantId || null,
      deliveryId,
      event: eventName,
      repo: payload.repository?.full_name || null,
      action: payload.action || null,
      pr,
    };
    await sqsSend({
      queueUrl: config.webhookQueueUrl,
      body: JSON.stringify(message),
      deduplicationId: deliveryId,
      groupId: message.repo || "github",
    });
    return json(202, { accepted: true, deliveryId });
  };
}

const defaultClient = new SQSClient({});

export async function defaultSqsSend({ queueUrl, body, deduplicationId, groupId }) {
  await defaultClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: body,
      MessageDeduplicationId: deduplicationId,
      MessageGroupId: groupId,
    })
  );
}
