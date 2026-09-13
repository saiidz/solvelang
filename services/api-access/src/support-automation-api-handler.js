import { ApiAccessError } from "./service.js";

function bodyText(event) {
  if (!event?.body) return "";
  return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
}
function parseJson(event) { const text = bodyText(event); return text ? JSON.parse(text) : {}; }
function header(event, name) { return event?.headers?.[name.toLowerCase()] ?? event?.headers?.[name]; }
function cookieHeader(event) {
  const direct = header(event, "cookie");
  if (typeof direct === "string" && direct) return direct;
  const cookies = Array.isArray(event?.cookies) ? event.cookies.filter((value) => typeof value === "string" && value) : [];
  return cookies.length ? cookies.join("; ") : undefined;
}

export function createSupportAutomationApiHandler({ enabled = false, supportAutomation, customerAuth, siteOrigin, logger = console }) {
  if (typeof siteOrigin !== "string" || !siteOrigin) throw new Error("Site origin is required.");
  if (enabled && (!supportAutomation || !customerAuth)) throw new Error("Support automation and customer auth are required when support automation is enabled.");

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
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        vary: "Origin",
      },
      body: JSON.stringify(body),
    };
  }

  async function session(event, mutation = false) {
    if (!enabled) throw new ApiAccessError(503, "support_automation_disabled", "Support automation is not enabled for this environment.");
    const authenticated = await customerAuth.authenticate(cookieHeader(event));
    if (mutation) customerAuth.assertCsrf(authenticated, header(event, "x-solvelang-csrf"));
    return authenticated;
  }

  return async function handle(event) {
    try {
      const method = event?.requestContext?.http?.method ?? "GET";
      const path = (event?.rawPath ?? "/").replace(/\/$/, "") || "/";
      if (method === "OPTIONS") return response(204, {});
      if (method === "GET" && path.endsWith("/customer/support-automation")) {
        return response(200, await supportAutomation.status(await session(event)));
      }
      if (method === "GET" && path.endsWith("/customer/support-automation/history")) {
        const rawLimit = event?.queryStringParameters?.limit;
        const limit = rawLimit === undefined ? 20 : Number(rawLimit);
        return response(200, { events: await supportAutomation.history(await session(event), limit) });
      }
      if (method === "POST" && path.endsWith("/customer/support-automation/config")) {
        return response(200, await supportAutomation.configure(await session(event, true), parseJson(event)));
      }
      if (method === "POST" && path.endsWith("/customer/support-automation/pause")) {
        return response(200, await supportAutomation.pause(await session(event, true)));
      }
      if (method === "POST" && path.endsWith("/customer/support-automation/resume")) {
        return response(200, await supportAutomation.resume(await session(event, true)));
      }
      if (method === "POST" && path.endsWith("/customer/support-automation/revoke")) {
        return response(200, await supportAutomation.revoke(await session(event, true)));
      }
      return response(404, { error: "Not found." });
    } catch (error) {
      if (error instanceof ApiAccessError) {
        logger.error({ type: "support_automation_api_error", code: error.code });
        return response(error.statusCode, { error: error.publicMessage, code: error.code });
      }
      if (error instanceof SyntaxError) return response(400, { error: "Invalid request.", code: "invalid_request" });
      logger.error({ type: "support_automation_api_error", code: "request_failed" });
      return response(500, { error: "Request failed.", code: "request_failed" });
    }
  };
}
