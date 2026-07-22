import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { z } from "zod";
import { issueEntitlement } from "./token.js";

const PRODUCT = "workflow-preflight-v1";
const checkoutSchema = z.object({ scanId: z.string().uuid() }).strict();
const entitlementSchema = z.object({ scanId: z.string().uuid(), sessionId: z.string().startsWith("pi_") }).strict();
const conversionEventSchema = z.object({
  name: z.enum([
    "check_page_view",
    "workflow_selected",
    "scan_completed",
    "scan_failed",
    "checkout_started",
    "payment_completed",
    "report_downloaded",
  ]),
}).strip();

export type EntitlementConfig = {
  siteOrigin: string;
  stripePriceId: string;
  stripeWebhookSecret: string;
  entitlementSigningSecret: string;
  mode: "test";
};

export type PaymentIntentSnapshot = {
  id: string;
  clientSecret?: string | null;
  paymentStatus?: string | null;
  metadata?: Record<string, string> | null;
};

export type StripeEvent = {
  id: string;
  type: string;
  paymentIntent?: PaymentIntentSnapshot;
};

export type StripeGateway = {
  payments: {
    create(params: {
      mode: "payment";
      lineItems: Array<{ price: string; quantity: number }>;
      returnUrl: string;
      metadata: { scanId: string; product: typeof PRODUCT };
    }, idempotencyKey: string): Promise<PaymentIntentSnapshot>;
    retrieve(paymentIntentId: string): Promise<PaymentIntentSnapshot>;
  };
  webhooks: {
    constructEvent(rawBody: Buffer, signature: string, secret: string): StripeEvent;
  };
};

export type EntitlementRecord = {
  scanId: string;
  // Compatibility field retained for existing browser recovery and stored records.
  sessionId: string;
  paymentStatus: string;
  stripeEventId: string;
  createdAt: string;
  expiresAt: number;
};

export type EntitlementStore = {
  putIfAbsent(record: EntitlementRecord): Promise<"created" | "duplicate">;
  get(scanId: string): Promise<EntitlementRecord | undefined>;
};

type SafeLogger = {
  info(record: Record<string, string>): void;
  error(record: Record<string, string>): void;
};

type ServiceDependencies = {
  config: EntitlementConfig;
  stripe: StripeGateway;
  store: EntitlementStore;
  now?: () => number;
  logger?: SafeLogger;
};

export type JsonResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

class RequestError extends Error {
  constructor(readonly statusCode: number, readonly publicMessage: string, readonly code: string) {
    super(publicMessage);
  }
}

function safeStripeToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = value.replace(/[^a-zA-Z0-9_.\[\]-]/g, "").slice(0, 80);
  return sanitized || undefined;
}

function stripeFailure(error: unknown): RequestError {
  const candidate = error as { type?: string; code?: string; param?: string };
  const stripeCode = safeStripeToken(candidate?.code);
  const stripeParam = safeStripeToken(candidate?.param);
  const diagnostic = [stripeCode ? `code=${stripeCode}` : "", stripeParam ? `param=${stripeParam}` : ""]
    .filter(Boolean)
    .join(", ");
  const suffix = diagnostic ? ` (${diagnostic})` : "";

  if (candidate?.type === "StripeAuthenticationError") {
    return new RequestError(502, `Stripe authentication failed. Verify the test secret key.${suffix}`, "stripe_authentication");
  }
  if (candidate?.code === "resource_missing") {
    return new RequestError(502, `Stripe resource was not found for this test account.${suffix}`, "stripe_resource_missing");
  }
  if (candidate?.type === "StripeInvalidRequestError") {
    return new RequestError(502, `Stripe rejected the payment configuration.${suffix}`, "stripe_invalid_request");
  }
  return new RequestError(502, `Stripe payment is temporarily unavailable.${suffix}`, "stripe_checkout_failed");
}

function parseJson(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return {};
  return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);
}

function rawBody(event: APIGatewayProxyEventV2): Buffer {
  if (!event.body) throw new RequestError(400, "Invalid webhook.", "invalid_webhook");
  return event.isBase64Encoded ? Buffer.from(event.body, "base64") : Buffer.from(event.body, "utf8");
}

export function createEntitlementService({
  config,
  stripe,
  store,
  now = Date.now,
  logger = console,
}: ServiceDependencies): (event: APIGatewayProxyEventV2) => Promise<JsonResponse> {
  function response(statusCode: number, body: unknown): JsonResponse {
    return {
      statusCode,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": config.siteOrigin,
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,stripe-signature",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
      body: JSON.stringify(body),
    };
  }

  async function createCheckout(event: APIGatewayProxyEventV2): Promise<JsonResponse> {
    const { scanId } = checkoutSchema.parse(parseJson(event));
    let paymentIntent: PaymentIntentSnapshot;
    try {
      paymentIntent = await stripe.payments.create({
        mode: "payment",
        lineItems: [{ price: config.stripePriceId, quantity: 1 }],
        returnUrl: `${config.siteOrigin}/check/?scan_id=${encodeURIComponent(scanId)}`,
        metadata: { scanId, product: PRODUCT },
      }, `preflight-${scanId}`);
    } catch (error) {
      throw stripeFailure(error);
    }
    if (!paymentIntent.clientSecret) throw new RequestError(502, "Payment is temporarily unavailable.", "payment_unavailable");
    return response(200, { clientSecret: paymentIntent.clientSecret, paymentId: paymentIntent.id });
  }

  async function handleWebhook(event: APIGatewayProxyEventV2): Promise<JsonResponse> {
    const signature = event.headers["stripe-signature"];
    if (!signature) throw new RequestError(400, "Invalid webhook.", "invalid_webhook");

    let stripeEvent: StripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(rawBody(event), signature, config.stripeWebhookSecret);
    } catch {
      throw new RequestError(400, "Invalid webhook.", "invalid_webhook_signature");
    }

    if (stripeEvent.type === "payment_intent.succeeded" && stripeEvent.paymentIntent) {
      const paymentIntent = stripeEvent.paymentIntent;
      const scanId = paymentIntent.metadata?.scanId;
      if (scanId && paymentIntent.metadata?.product === PRODUCT && paymentIntent.paymentStatus === "paid") {
        const timestamp = now();
        await store.putIfAbsent({
          scanId,
          sessionId: paymentIntent.id,
          paymentStatus: "paid",
          stripeEventId: stripeEvent.id,
          createdAt: new Date(timestamp).toISOString(),
          expiresAt: Math.floor(timestamp / 1000) + 60 * 60 * 24 * 30,
        });
      }
    }
    return response(200, { received: true });
  }

  async function createEntitlement(event: APIGatewayProxyEventV2): Promise<JsonResponse> {
    const { scanId, sessionId } = entitlementSchema.parse(parseJson(event));
    const [stored, paymentIntent] = await Promise.all([store.get(scanId), stripe.payments.retrieve(sessionId)]);
    if (
      !stored
      || stored.paymentStatus !== "paid"
      || stored.sessionId !== sessionId
      || stored.expiresAt <= Math.floor(now() / 1000)
      || paymentIntent.paymentStatus !== "paid"
      || paymentIntent.metadata?.scanId !== scanId
      || paymentIntent.metadata?.product !== PRODUCT
    ) {
      return response(403, { error: "No matching paid payment was found." });
    }
    const exp = Math.floor(now() / 1000) + 15 * 60;
    return response(200, {
      token: issueEntitlement({ version: 1, scanId, sessionId, exp }, config.entitlementSigningSecret),
      expiresAt: new Date(exp * 1000).toISOString(),
    });
  }

  function recordConversion(event: APIGatewayProxyEventV2): JsonResponse {
    const { name } = conversionEventSchema.parse(parseJson(event));
    logger.info({ type: "conversion_event", name, at: new Date(now()).toISOString() });
    return response(202, { accepted: true });
  }

  return async function service(event: APIGatewayProxyEventV2): Promise<JsonResponse> {
    try {
      const method = event.requestContext.http.method;
      const path = event.rawPath.replace(/\/$/, "");
      if (method === "OPTIONS") return response(204, {});
      if (method === "GET" && path.endsWith("/health")) {
        return response(200, { status: "ok", service: "solvelang-entitlements", mode: config.mode });
      }
      if (method === "POST" && path.endsWith("/checkout")) return await createCheckout(event);
      if (method === "POST" && path.endsWith("/webhook")) return await handleWebhook(event);
      if (method === "POST" && path.endsWith("/entitlement")) return await createEntitlement(event);
      if (method === "POST" && path.endsWith("/events")) return recordConversion(event);
      return response(404, { error: "Not found." });
    } catch (error) {
      if (error instanceof RequestError) {
        logger.error({ type: "entitlement_api_error", code: error.code });
        return response(error.statusCode, { error: error.publicMessage });
      }
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        logger.error({ type: "entitlement_api_error", code: "invalid_request" });
        return response(400, { error: "Invalid request." });
      }
      logger.error({ type: "entitlement_api_error", code: "request_failed" });
      return response(500, { error: "Request failed." });
    }
  };
}
