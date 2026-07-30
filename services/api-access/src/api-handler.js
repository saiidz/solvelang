import { timingSafeEqual } from "node:crypto";
import { PriorityJobError } from "./priority-jobs.js";
import { ApiAccessError } from "./service.js";

function secureEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function bodyText(event) {
  if (!event?.body) return "";
  return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
}

function parseJson(event) {
  const text = bodyText(event);
  return text ? JSON.parse(text) : {};
}

function header(event, name) {
  return event?.headers?.[name.toLowerCase()] ?? event?.headers?.[name];
}

export function createApiAccessHandler({
  service,
  enabled = false,
  adminSecret,
  siteOrigin,
  customerAccountsEnabled = false,
  customerAuth,
  customerAccount,
  priorityQueueEnabled = false,
  priorityJobs,
  subscriptionBillingEnabled = false,
  subscriptionCheckout,
  subscriptionLifecycle,
  stripeGateway,
  logger = console,
}) {
  if (!service) throw new Error("API access service is required.");
  if (typeof adminSecret !== "string" || adminSecret.length < 32) throw new Error("API access admin secret is required.");
  if (typeof siteOrigin !== "string" || !siteOrigin) throw new Error("Site origin is required.");
  if (customerAccountsEnabled && (!customerAuth || !customerAccount)) {
    throw new Error("Customer account services are required when customer accounts are enabled.");
  }
  if (priorityQueueEnabled && !priorityJobs) {
    throw new Error("Priority job service is required when the queue is enabled.");
  }
  if (subscriptionBillingEnabled && (!subscriptionCheckout || !subscriptionLifecycle || !stripeGateway)) {
    throw new Error("Stripe subscription services are required when billing is enabled.");
  }

  function response(statusCode, body, extraHeaders = {}) {
    return {
      statusCode,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": siteOrigin,
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "authorization,content-type,idempotency-key,x-solvelang-admin-secret,x-solvelang-csrf,stripe-signature",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        vary: "Origin",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    };
  }

  function requireAdmin(event) {
    const presented = header(event, "x-solvelang-admin-secret");
    if (!secureEqual(presented, adminSecret)) throw new ApiAccessError(403, "admin_denied", "Administrative access was denied.");
  }

  async function customerSession(event, mutation = false) {
    if (!customerAccountsEnabled) throw new ApiAccessError(503, "customer_accounts_disabled", "Customer API accounts are not enabled.");
    const session = await customerAuth.authenticate(header(event, "cookie"));
    if (mutation) customerAuth.assertCsrf(session, header(event, "x-solvelang-csrf"));
    return session;
  }

  return async function handle(event) {
    try {
      const method = event?.requestContext?.http?.method ?? "GET";
      const path = (event?.rawPath ?? "/").replace(/\/$/, "") || "/";
      if (method === "OPTIONS") return response(204, {});
      if (method === "GET" && path.endsWith("/health")) {
        return response(200, {
          status: "ok",
          service: "solvelang-api-access",
          enabled,
          customerAccountsEnabled,
          priorityQueueEnabled,
          subscriptionBillingEnabled,
        });
      }

      if (method === "POST" && path.endsWith("/stripe/subscriptions/webhook")) {
        if (!subscriptionBillingEnabled) throw new ApiAccessError(503, "subscription_billing_disabled", "API subscription billing is not enabled.");
        const signature = header(event, "stripe-signature");
        if (typeof signature !== "string" || !signature) throw new ApiAccessError(400, "invalid_webhook", "Invalid webhook.");
        let stripeEvent;
        try {
          stripeEvent = stripeGateway.constructWebhookEvent(Buffer.from(bodyText(event), "utf8"), signature);
        } catch {
          throw new ApiAccessError(400, "invalid_webhook_signature", "Invalid webhook.");
        }
        const result = await subscriptionLifecycle.processEvent(stripeEvent);
        return response(200, { received: true, handled: result.handled, duplicate: result.duplicate });
      }

      if (method === "POST" && path.endsWith("/customer/auth/magic-link")) {
        if (!customerAccountsEnabled) throw new ApiAccessError(503, "customer_accounts_disabled", "Customer API accounts are not enabled.");
        await customerAuth.requestMagicLink(parseJson(event), { sourceIp: event?.requestContext?.http?.sourceIp });
        return response(202, { accepted: true, message: "If the address is valid, a sign-in link will arrive shortly." });
      }
      if (method === "POST" && path.endsWith("/customer/auth/verify")) {
        if (!customerAccountsEnabled) throw new ApiAccessError(503, "customer_accounts_disabled", "Customer API accounts are not enabled.");
        const verified = await customerAuth.verifyMagicLink(parseJson(event));
        return response(200, {
          accountId: verified.accountId,
          email: verified.email,
          csrfToken: verified.csrfToken,
        }, { "set-cookie": verified.cookie });
      }
      if (method === "POST" && path.endsWith("/customer/auth/logout")) {
        const session = await customerSession(event, true);
        const cookie = await customerAuth.logout(header(event, "cookie"));
        return response(200, { signedOut: true, accountId: session.accountId }, { "set-cookie": cookie });
      }

      if (!enabled) throw new ApiAccessError(503, "api_access_disabled", "API subscriptions are not enabled.");

      if (method === "GET" && path.endsWith("/v1/whoami")) {
        const context = event?.requestContext?.authorizer?.lambda;
        if (!context?.accountId || !context?.keyId) throw new ApiAccessError(401, "not_authorized", "API authorization is required.");
        return response(200, {
          accountId: context.accountId,
          keyId: context.keyId,
          plan: context.plan,
          scopes: typeof context.scopes === "string" ? context.scopes.split(" ").filter(Boolean) : [],
          subscriptionStatus: context.subscriptionStatus,
          usageRemaining: context.usageRemaining,
        });
      }

      if (method === "GET" && path.endsWith("/customer/account")) {
        const session = await customerSession(event);
        return response(200, { ...(await customerAccount.getDashboard(session)), csrfToken: session.csrfToken });
      }
      if (method === "POST" && path.endsWith("/customer/keys")) {
        const session = await customerSession(event, true);
        return response(201, await customerAccount.issueKey(session, parseJson(event)));
      }
      if (method === "POST" && path.endsWith("/customer/keys/revoke")) {
        const session = await customerSession(event, true);
        return response(200, await customerAccount.revokeKey(session, parseJson(event)));
      }
      if (method === "POST" && path.endsWith("/customer/subscriptions/checkout")) {
        const session = await customerSession(event, true);
        if (!subscriptionBillingEnabled) throw new ApiAccessError(503, "subscription_billing_disabled", "API subscription billing is not enabled.");
        const body = parseJson(event);
        const account = await service.getSubscriptionAccount(session.accountId);
        return response(201, await subscriptionCheckout.createCheckout({
          accountId: session.accountId,
          email: session.email,
          plan: body.plan,
          requestId: body.requestId,
          customerId: account?.stripeCustomerId,
        }));
      }

      requireAdmin(event);
      const body = parseJson(event);
      if (method === "POST" && path.endsWith("/internal/subscriptions/checkout")) {
        return response(201, await subscriptionCheckout.createCheckout(body));
      }
      if (method === "POST" && path.endsWith("/internal/subscriptions/provision")) {
        return response(200, { account: await service.provisionSubscription(body) });
      }
      if (method === "POST" && path.endsWith("/internal/keys")) {
        return response(201, await service.issueApiKey(body));
      }
      if (method === "POST" && path.endsWith("/internal/keys/revoke")) {
        return response(200, await service.revokeApiKey(body));
      }
      if (method === "POST" && path.endsWith("/internal/usage/consume")) {
        return response(200, await service.consumeUsage(body));
      }
      if (method === "POST" && path.endsWith("/internal/jobs/canary")) {
        if (!priorityQueueEnabled) throw new PriorityJobError(503, "priority_queue_disabled", "Priority processing is not enabled.");
        return response(202, await priorityJobs.submitCanary(body));
      }
      const jobMatch = path.match(/\/internal\/jobs\/(job_[a-f0-9]{32})$/);
      if (method === "GET" && jobMatch) {
        if (!priorityQueueEnabled) throw new PriorityJobError(503, "priority_queue_disabled", "Priority processing is not enabled.");
        return response(200, await priorityJobs.getJob(jobMatch[1]));
      }
      return response(404, { error: "Not found." });
    } catch (error) {
      if (error instanceof ApiAccessError || error instanceof PriorityJobError) {
        logger.error({ type: "api_access_error", code: error.code });
        return response(error.statusCode, { error: error.publicMessage, code: error.code });
      }
      if (error instanceof SyntaxError) {
        logger.error({ type: "api_access_error", code: "invalid_json" });
        return response(400, { error: "Invalid request.", code: "invalid_request" });
      }
      logger.error({ type: "api_access_error", code: "request_failed" });
      return response(500, { error: "Request failed.", code: "request_failed" });
    }
  };
}
