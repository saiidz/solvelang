import { ApiAccessError } from "./service.js";
import { PriorityJobError } from "./priority-jobs.js";

function header(event, name) {
  return event?.headers?.[name.toLowerCase()] ?? event?.headers?.[name];
}

function cookieHeader(event) {
  const direct = header(event, "cookie");
  if (typeof direct === "string" && direct) return direct;
  if (!Array.isArray(event?.cookies)) return undefined;
  return event.cookies.filter((cookie) => typeof cookie === "string" && cookie).join("; ") || undefined;
}

function parseJson(event) {
  if (!event?.body) return {};
  const text = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  return text ? JSON.parse(text) : {};
}

export function createCustomerPriorityHandler({ customerAuth, priority, siteOrigin, logger = console }) {
  if (!customerAuth || typeof customerAuth.authenticate !== "function" || typeof customerAuth.assertCsrf !== "function") {
    throw new Error("Customer authentication service is required.");
  }
  if (!priority || typeof priority.quote !== "function" || typeof priority.submit !== "function" || typeof priority.getJob !== "function") {
    throw new Error("Customer priority service is required.");
  }
  if (typeof siteOrigin !== "string" || !siteOrigin) throw new Error("Site origin is required.");

  function response(statusCode, body) {
    return {
      statusCode,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": siteOrigin,
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,x-solvelang-csrf",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        vary: "Origin",
      },
      body: JSON.stringify(body),
    };
  }

  async function session(event, mutation = false) {
    const authenticated = await customerAuth.authenticate(cookieHeader(event));
    if (mutation) customerAuth.assertCsrf(authenticated, header(event, "x-solvelang-csrf"));
    return authenticated;
  }

  return async function handle(event) {
    try {
      const method = event?.requestContext?.http?.method ?? "GET";
      const path = (event?.rawPath ?? "/").replace(/\/$/, "") || "/";
      if (method === "OPTIONS") return response(204, {});
      if (method === "POST" && path.endsWith("/customer/priority/quote")) {
        const authenticated = await session(event, true);
        const body = parseJson(event);
        return response(200, { quote: await priority.quote({ accountId: authenticated.accountId, ...body }) });
      }
      if (method === "POST" && path.endsWith("/customer/priority/jobs")) {
        const authenticated = await session(event, true);
        const body = parseJson(event);
        return response(201, { job: await priority.submit({ accountId: authenticated.accountId, ...body }) });
      }
      if (method === "GET" && path.includes("/customer/priority/jobs/")) {
        const authenticated = await session(event);
        const jobId = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
        return response(200, { job: await priority.getJob({ accountId: authenticated.accountId, jobId }) });
      }
      return response(404, { error: "Not found.", code: "not_found" });
    } catch (error) {
      if (error instanceof PriorityJobError || error instanceof ApiAccessError) {
        logger.error({ type: "customer_priority_error", code: error.code });
        return response(error.statusCode, { error: error.publicMessage, code: error.code });
      }
      if (error instanceof SyntaxError) return response(400, { error: "Invalid request.", code: "invalid_request" });
      logger.error({ type: "customer_priority_error", code: "request_failed" });
      return response(500, { error: "Request failed.", code: "request_failed" });
    }
  };
}
