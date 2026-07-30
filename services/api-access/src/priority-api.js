import { timingSafeEqual } from "node:crypto";
import { PriorityJobError } from "./priority-jobs.js";

function secureEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseJson(event) {
  if (!event?.body) return {};
  const text = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  return JSON.parse(text);
}

function header(event, name) {
  return event?.headers?.[name.toLowerCase()] ?? event?.headers?.[name];
}

export function createPriorityAdminHandler({ service, enabled = false, adminSecret, logger = console }) {
  if (!service) throw new Error("Priority job service is required.");
  if (typeof adminSecret !== "string" || adminSecret.length < 32) throw new Error("Priority admin secret is required.");

  function response(statusCode, body) {
    return {
      statusCode,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
      body: JSON.stringify(body),
    };
  }

  function requireAdmin(event) {
    if (!secureEqual(header(event, "x-solvelang-admin-secret"), adminSecret)) {
      throw new PriorityJobError(403, "admin_denied", "Administrative access was denied.");
    }
  }

  return async function handle(event) {
    try {
      const method = event?.requestContext?.http?.method ?? "GET";
      const path = (event?.rawPath ?? "/").replace(/\/$/, "") || "/";
      if (method === "GET" && path.endsWith("/health")) {
        return response(200, { status: "ok", service: "solvelang-priority-queue", enabled });
      }
      requireAdmin(event);
      if (method === "POST" && path.endsWith("/internal/jobs/canary")) {
        return response(202, await service.submitCanary(parseJson(event)));
      }
      const match = path.match(/\/internal\/jobs\/(job_[a-f0-9]{32})$/);
      if (method === "GET" && match) return response(200, await service.getJob(match[1]));
      return response(404, { error: "Not found." });
    } catch (error) {
      if (error instanceof PriorityJobError) {
        logger.error({ type: "priority_api_error", code: error.code });
        return response(error.statusCode, { error: error.publicMessage, code: error.code });
      }
      if (error instanceof SyntaxError) {
        logger.error({ type: "priority_api_error", code: "invalid_json" });
        return response(400, { error: "Invalid request.", code: "invalid_request" });
      }
      logger.error({ type: "priority_api_error", code: "request_failed" });
      return response(500, { error: "Request failed.", code: "request_failed" });
    }
  };
}
