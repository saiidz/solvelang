import { ApiAccessError } from "./service.js";

function header(event, name) {
  return event?.headers?.[name.toLowerCase()] ?? event?.headers?.[name];
}

function cookieHeader(event) {
  const direct = header(event, "cookie");
  if (typeof direct === "string" && direct) return direct;
  if (!Array.isArray(event?.cookies)) return undefined;
  const cookies = event.cookies.filter((cookie) => typeof cookie === "string" && cookie);
  return cookies.length > 0 ? cookies.join("; ") : undefined;
}

function parseJson(event) {
  if (!event?.body) return {};
  const text = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  return text ? JSON.parse(text) : {};
}

export function createSubscriptionManagementHandler({ customerAuth, management, siteOrigin, enabled = false, logger = console }) {
  if (!customerAuth || typeof customerAuth.authenticate !== "function" || typeof customerAuth.assertCsrf !== "function") {
    throw new Error("Customer authentication service is required.");
  }
  if (!management) throw new Error("Subscription management service is required.");
  if (typeof siteOrigin !== "string" || !/^https:\/\//.test(siteOrigin)) throw new Error("HTTPS site origin is required.");

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

  async function managementState(session) {
    return {
      ...(await management.getManagement({ accountId: session.accountId })),
      csrfToken: session.csrfToken,
    };
  }

  return async function handle(event) {
    try {
      const method = event?.requestContext?.http?.method ?? "GET";
      if (method === "OPTIONS") return response(204, {});
      if (!enabled) throw new ApiAccessError(503, "subscription_management_disabled", "API subscription management is not enabled.");
      const session = await customerAuth.authenticate(cookieHeader(event));

      if (method === "GET") return response(200, await managementState(session));
      if (method !== "POST") return response(405, { error: "Method not allowed.", code: "method_not_allowed" });

      customerAuth.assertCsrf(session, header(event, "x-solvelang-csrf"));
      const body = parseJson(event);
      if (body.action === "get_management") return response(200, await managementState(session));
      if (body.action === "create_payment_setup") {
        return response(201, await management.createPaymentSetup({ accountId: session.accountId }));
      }
      if (body.action === "complete_payment_setup") {
        return response(200, await management.completePaymentSetup({
          accountId: session.accountId,
          setupIntentId: body.setupIntentId,
        }));
      }
      if (body.action === "cancel_at_period_end") {
        return response(200, await management.setCancellation({ accountId: session.accountId, cancelAtPeriodEnd: true }));
      }
      if (body.action === "resume_subscription") {
        return response(200, await management.setCancellation({ accountId: session.accountId, cancelAtPeriodEnd: false }));
      }
      throw new ApiAccessError(400, "invalid_subscription_management", "Subscription management action is invalid.");
    } catch (error) {
      if (error instanceof ApiAccessError) {
        logger.error({ type: "subscription_management_error", code: error.code });
        return response(error.statusCode, { error: error.publicMessage, code: error.code });
      }
      if (error instanceof SyntaxError) {
        return response(400, { error: "Invalid request.", code: "invalid_request" });
      }
      logger.error({ type: "subscription_management_error", code: "request_failed" });
      return response(500, { error: "Request failed.", code: "request_failed" });
    }
  };
}
