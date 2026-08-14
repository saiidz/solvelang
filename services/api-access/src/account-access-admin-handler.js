import { timingSafeEqual } from "node:crypto";
import { ApiAccessError } from "./service.js";

function secureEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function header(event, name) {
  return event?.headers?.[name.toLowerCase()] ?? event?.headers?.[name];
}

function bodyText(event) {
  if (!event?.body) return "";
  return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
}

function parseJson(event) {
  const text = bodyText(event);
  return text ? JSON.parse(text) : {};
}

export function createAccountAccessAdminHandler({ accountAccess, adminSecret, siteOrigin, logger = console }) {
  if (!accountAccess
    || typeof accountAccess.getStatus !== "function"
    || typeof accountAccess.transition !== "function") {
    throw new Error("Account access service is required.");
  }
  if (typeof adminSecret !== "string" || adminSecret.length < 32) throw new Error("API access admin secret is required.");
  if (typeof siteOrigin !== "string" || !siteOrigin) throw new Error("Site origin is required.");

  function response(statusCode, body) {
    return {
      statusCode,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": siteOrigin,
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,x-solvelang-admin-secret",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        vary: "Origin",
      },
      body: JSON.stringify(body),
    };
  }

  function requireAdmin(event) {
    if (!secureEqual(header(event, "x-solvelang-admin-secret"), adminSecret)) {
      throw new ApiAccessError(403, "admin_denied", "Administrative access was denied.");
    }
  }

  return async function handle(event) {
    try {
      const method = event?.requestContext?.http?.method ?? "GET";
      if (method === "OPTIONS") return response(204, {});
      requireAdmin(event);
      if (method === "GET") {
        return response(200, { account: await accountAccess.getStatus(event?.queryStringParameters?.accountId) });
      }
      if (method === "POST") {
        return response(200, { account: await accountAccess.transition(parseJson(event), "api-access-admin") });
      }
      return response(405, { error: "Method not allowed.", code: "method_not_allowed" });
    } catch (error) {
      if (error instanceof ApiAccessError) {
        logger.error({ type: "account_access_admin_error", code: error.code });
        return response(error.statusCode, { error: error.publicMessage, code: error.code });
      }
      if (error instanceof SyntaxError) {
        logger.error({ type: "account_access_admin_error", code: "invalid_json" });
        return response(400, { error: "Invalid request.", code: "invalid_request" });
      }
      logger.error({ type: "account_access_admin_error", code: "request_failed" });
      return response(500, { error: "Request failed.", code: "request_failed" });
    }
  };
}
