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

function pathOf(event) {
  return (event?.rawPath ?? "/").replace(/\/$/, "") || "/";
}

function bodyText(event) {
  if (!event?.body) return "";
  return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
}

function parseJson(event) {
  const value = bodyText(event);
  return value ? JSON.parse(value) : {};
}

function identityFrom(value = {}) {
  return {
    accountId: value.accountId,
    email: value.email,
    username: value.username,
  };
}

export function createAdminCustomerHandler({
  customers,
  adminSecret,
  siteOrigin,
  logger = console,
}) {
  if (!customers
    || typeof customers.getCustomer !== "function"
    || typeof customers.listCustomers !== "function"
    || typeof customers.updateProfile !== "function"
    || typeof customers.addNote !== "function"
    || typeof customers.createTask !== "function"
    || typeof customers.updateTask !== "function") {
    throw new Error("Admin customer service is required.");
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
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
        "referrer-policy": "no-referrer",
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
      const path = pathOf(event);

      if (method === "GET" && path.endsWith("/internal/admin/customers")) {
        const query = event?.queryStringParameters ?? {};
        const hasIdentity = query.accountId !== undefined || query.email !== undefined || query.username !== undefined;
        if (hasIdentity) return response(200, await customers.getCustomer(identityFrom(query)));
        return response(200, await customers.listCustomers({ limit: query.limit ? Number(query.limit) : 50, cursor: query.cursor }));
      }

      if (method === "POST") {
        const body = parseJson(event);
        const identity = identityFrom(body.identity);
        if (path.endsWith("/internal/admin/customers/profile")) {
          return response(200, { profile: await customers.updateProfile(identity, body.profile, "admin-console") });
        }
        if (path.endsWith("/internal/admin/customers/notes")) {
          return response(201, { note: await customers.addNote(identity, body.note, "admin-console") });
        }
        if (path.endsWith("/internal/admin/customers/tasks")) {
          return response(201, { task: await customers.createTask(identity, body.task, "admin-console") });
        }
        if (path.endsWith("/internal/admin/customers/tasks/update")) {
          return response(200, { task: await customers.updateTask(identity, body.task, "admin-console") });
        }
      }

      return response(405, { error: "Method not allowed.", code: "method_not_allowed" });
    } catch (error) {
      if (error instanceof ApiAccessError) {
        logger.error({ type: "admin_customer_error", code: error.code });
        return response(error.statusCode, { error: error.publicMessage, code: error.code });
      }
      if (error instanceof SyntaxError) {
        logger.error({ type: "admin_customer_error", code: "invalid_json" });
        return response(400, { error: "Invalid request.", code: "invalid_request" });
      }
      logger.error({ type: "admin_customer_error", code: "request_failed" });
      return response(500, { error: "Request failed.", code: "request_failed" });
    }
  };
}
