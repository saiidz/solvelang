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

function assertTenantSecretReference(value, accountId) {
  if (typeof value !== "string" || typeof accountId !== "string" || !accountId) {
    throw new ApiAccessError(400, "invalid_support_automation_secret_ref", "Provider credential references must be scoped to the authenticated account.");
  }
  const tenantPath = `:secret:solvelang/support-automation/${accountId}/`;
  if (!value.includes(tenantPath)) {
    throw new ApiAccessError(400, "invalid_support_automation_secret_ref", "Provider credential references must be scoped to the authenticated account.");
  }
}

function assertTenantConfiguration(input, accountId) {
  if (!input || typeof input !== "object") {
    throw new ApiAccessError(400, "invalid_support_automation_request", "Support automation configuration is invalid.");
  }
  assertTenantSecretReference(input.gmailCredentialSecretArn, accountId);
  assertTenantSecretReference(input.linearCredentialSecretArn, accountId);
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
    const authenticated = await customerAuth.authenticate(cookieHeader(event));
    if (mutation) customerAuth.assertCsrf(authenticated, header(event, "x-solvelang-csrf"));
    return authenticated;
  }

  return async function handle(event) {
    try {
      const method = event?.requestContext?.http?.method ?? "GET";
      const path = (event?.rawPath ?? "/").replace(/\/$/, "") || "/";
      if (method === "OPTIONS") return response(204, {});
      if (!enabled) throw new ApiAccessError(503, "support_automation_disabled", "Support automation is not enabled for this environment.");
      if (method === "GET" && path.endsWith("/customer/support-automation")) {
        const authenticated = await session(event);
        return response(200, await supportAutomation.status(authenticated));
      }
      if (method === "GET" && path.endsWith("/customer/support-automation/history")) {
        const authenticated = await session(event);
        const rawLimit = event?.queryStringParameters?.limit;
        const limit = rawLimit === undefined ? 20 : Number(rawLimit);
        return response(200, { events: await supportAutomation.history(authenticated, limit) });
      }
      if (method === "POST" && path.endsWith("/customer/support-automation/config")) {
        const authenticated = await session(event, true);
        const input = parseJson(event);
        assertTenantConfiguration(input, authenticated.accountId);
        return response(200, await supportAutomation.configure(authenticated, input));
      }
      if (method === "POST" && path.endsWith("/customer/support-automation/pause")) {
        const authenticated = await session(event, true);
        return response(200, await supportAutomation.pause(authenticated));
      }
      if (method === "POST" && path.endsWith("/customer/support-automation/resume")) {
        const authenticated = await session(event, true);
        return response(200, await supportAutomation.resume(authenticated));
      }
      if (method === "POST" && path.endsWith("/customer/support-automation/revoke")) {
        const authenticated = await session(event, true);
        return response(200, await supportAutomation.revoke(authenticated));
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
