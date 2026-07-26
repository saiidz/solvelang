import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { DurableConfirmationGateway } from "./confirmation.js";
import { CONTRACT_REFUND_POLICY_TEXT, CONTRACT_TERMS_TEXT } from "./terms.js";
import { issueEntitlement } from "./token.js";
import { TERMS_VERSION } from "./terms.js";
import type { TurnstileGateway } from "./turnstile.js";

const PRODUCT = "workflow-preflight-v1";
const checkoutSchema = z.object({
  scanId: z.string().uuid(),
  turnstileToken: z.string().min(1).max(2_048),
  customerEmail: z.string().email().max(254),
  termsAccepted: z.literal(true),
  immediatePerformanceRequested: z.literal(true),
  withdrawalAcknowledged: z.literal(true),
  termsVersion: z.literal(TERMS_VERSION),
}).strict();
const entitlementSchema = z.object({ scanId: z.string().uuid(), sessionId: z.string().startsWith("pi_") }).strict();
const withdrawalSchema = z.object({
  name: z.string().trim().min(1).max(160),
  contractReference: z.string().trim().startsWith("pi_").max(160),
  email: z.string().email().max(254),
  statement: z.string().trim().min(8).max(1_000),
  turnstileToken: z.string().min(1).max(2_048),
  requestId: z.string().uuid(),
}).strict();
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
  stripeWebhookSecret: string;
  entitlementSigningSecret: string;
  mode: "test" | "production";
  checkoutEnabled: boolean;
  durableConfirmationEnabled: boolean;
};

export type PaymentIntentSnapshot = {
  id: string;
  clientSecret?: string | null;
  receiptEmail?: string | null;
  createdAt?: number;
  paymentStatus?: string | null;
  refundStatus: "none" | "partial" | "full";
  metadata?: Record<string, string> | null;
};

export type StripeEvent = {
  id: string;
  type: string;
  paymentIntent?: PaymentIntentSnapshot;
  refund?: { paymentIntentId: string };
};

export type StripeGateway = {
  payments: {
    create(params: {
      metadata: {
        scanId: string;
        product: typeof PRODUCT;
        termsVersion: typeof TERMS_VERSION;
        immediatePerformanceRequested: "true";
        withdrawalAcknowledged: "true";
      };
      receiptEmail: string;
    }, idempotencyKey: string): Promise<PaymentIntentSnapshot>;
    updateMetadata(
      paymentIntentId: string,
      metadata: { termsAcceptedAt: string },
      idempotencyKey: string,
    ): Promise<void>;
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
  refundStatus?: "none" | "partial" | "full";
  refundEventId?: string;
  refundUpdatedAt?: string;
  stripeEventId: string;
  createdAt: string;
  expiresAt: number;
};

export type EntitlementStore = {
  putIfAbsent(record: EntitlementRecord): Promise<"created" | "duplicate">;
  updateRefundStatus(
    scanId: string,
    paymentIntentId: string,
    refundStatus: "partial" | "full",
    eventId: string,
    updatedAt: string,
  ): Promise<"updated" | "duplicate_or_missing">;
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
  turnstile: TurnstileGateway;
  durableConfirmation: DurableConfirmationGateway;
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
  return new RequestError(502, `Stripe payment is temporarily unavailable.${suffix}`, "stripe_payment_failed");
}

function parseJson(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return {};
  return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);
}

function rawBody(event: APIGatewayProxyEventV2): Buffer {
  if (!event.body) throw new RequestError(400, "Invalid webhook.", "invalid_webhook");
  return event.isBase64Encoded ? Buffer.from(event.body, "base64") : Buffer.from(event.body, "utf8");
}

function consentTimestamp(createdAt: number | undefined): string {
  if (typeof createdAt !== "number" || !Number.isSafeInteger(createdAt) || createdAt <= 0) {
    throw new RequestError(502, "Payment is temporarily unavailable.", "payment_created_at_unavailable");
  }
  return new Date(createdAt * 1_000).toISOString();
}

export function createEntitlementService({
  config,
  stripe,
  store,
  turnstile,
  durableConfirmation,
  now = Date.now,
  logger = console,
}: ServiceDependencies): (event: APIGatewayProxyEventV2) => Promise<JsonResponse> {
  // This short-lived per-container limit supplements Turnstile and avoids
  // queueing repeated legal notices from one source during a burst.
  const withdrawalAttempts = new Map<string, { count: number; resetAt: number }>();

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
    if (!config.checkoutEnabled) {
      throw new RequestError(503, "Checkout is temporarily unavailable.", "checkout_disabled");
    }
    const {
      scanId,
      turnstileToken,
      customerEmail,
      termsVersion,
    } = checkoutSchema.parse(parseJson(event));
    let verified: boolean;
    try {
      verified = await turnstile.verify({ token: turnstileToken, remoteIp: event.requestContext.http.sourceIp, expectedAction: "checkout" });
    } catch {
      throw new RequestError(503, "Verification is temporarily unavailable.", "turnstile_unavailable");
    }
    if (!verified) {
      throw new RequestError(403, "Verification could not be completed.", "turnstile_rejected");
    }

    let paymentIntent: PaymentIntentSnapshot;
    try {
      paymentIntent = await stripe.payments.create({
        metadata: {
          scanId,
          product: PRODUCT,
          termsVersion,
          immediatePerformanceRequested: "true",
          withdrawalAcknowledged: "true",
        },
        receiptEmail: customerEmail,
      }, `preflight-${scanId}`);
    } catch (error) {
      throw stripeFailure(error);
    }
    const termsAcceptedAt = consentTimestamp(paymentIntent.createdAt);
    try {
      await stripe.payments.updateMetadata(
        paymentIntent.id,
        { termsAcceptedAt },
        `preflight-${scanId}-consent-${termsVersion}`,
      );
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
      const termsAcceptedAt = paymentIntent.metadata?.termsAcceptedAt;
      if (!scanId || paymentIntent.metadata?.product !== PRODUCT || paymentIntent.paymentStatus !== "paid" || !paymentIntent.receiptEmail || paymentIntent.metadata?.termsVersion !== TERMS_VERSION || paymentIntent.metadata?.immediatePerformanceRequested !== "true" || paymentIntent.metadata?.withdrawalAcknowledged !== "true" || !termsAcceptedAt) {
        throw new RequestError(400, "Invalid webhook.", "invalid_payment_confirmation");
      }
      if (!config.durableConfirmationEnabled) {
        throw new RequestError(503, "Confirmation is temporarily unavailable.", "confirmation_queue_unavailable");
      }
      try {
        await durableConfirmation.queueContractConfirmation({
          email: paymentIntent.receiptEmail,
          paymentIntentId: paymentIntent.id,
          product: "Workflow Preflight",
          total: "USD $49",
          termsVersion: TERMS_VERSION,
          termsAcceptedAt,
          immediatePerformanceRequested: true,
          withdrawalAcknowledged: true,
          deliveryDescription: "An automated Workflow Preflight report is processed and delivered immediately after successful payment.",
          supportEmail: "hello@solve-lang.com",
          termsText: CONTRACT_TERMS_TEXT,
          refundPolicyText: CONTRACT_REFUND_POLICY_TEXT,
          idempotencyKey: `contract-confirmation-${paymentIntent.id}-${TERMS_VERSION}`,
        });
      } catch {
        throw new RequestError(503, "Confirmation is temporarily unavailable.", "confirmation_queue_unavailable");
      }
      const timestamp = now();
      await store.putIfAbsent({
        scanId,
        sessionId: paymentIntent.id,
        paymentStatus: "paid",
        refundStatus: paymentIntent.refundStatus,
        stripeEventId: stripeEvent.id,
        createdAt: new Date(timestamp).toISOString(),
        expiresAt: Math.floor(timestamp / 1000) + 60 * 60 * 24 * 30,
      });
    }
    if (stripeEvent.type === "charge.refunded" && stripeEvent.refund) {
      const paymentIntent = await stripe.payments.retrieve(stripeEvent.refund.paymentIntentId);
      const scanId = paymentIntent.metadata?.scanId;
      if (
        scanId
        && paymentIntent.metadata?.product === PRODUCT
        && (paymentIntent.refundStatus === "partial" || paymentIntent.refundStatus === "full")
      ) {
        await store.updateRefundStatus(
          scanId,
          paymentIntent.id,
          paymentIntent.refundStatus,
          stripeEvent.id,
          new Date(now()).toISOString(),
        );
      }
    }
    return response(200, { received: true });
  }

  async function createEntitlement(event: APIGatewayProxyEventV2): Promise<JsonResponse> {
    const { scanId, sessionId } = entitlementSchema.parse(parseJson(event));
    const [stored, paymentIntent] = await Promise.all([store.get(scanId), stripe.payments.retrieve(sessionId)]);
    if (paymentIntent.paymentStatus !== "paid") {
      return response(402, { code: "payment_not_succeeded", error: "Payment has not succeeded." });
    }
    if (paymentIntent.metadata?.scanId !== scanId || paymentIntent.metadata?.product !== PRODUCT) {
      return response(403, { code: "payment_mismatch", error: "Payment does not match this scan." });
    }
    if (paymentIntent.refundStatus === "full") {
      return response(403, { code: "payment_refunded", error: "This payment was fully refunded and is no longer eligible." });
    }
    if (!stored) {
      return response(409, { code: "payment_pending", error: "Payment succeeded and is awaiting webhook verification." });
    }
    if (
      stored.paymentStatus !== "paid"
      || stored.sessionId !== sessionId
      || stored.expiresAt <= Math.floor(now() / 1000)
    ) {
      return response(403, { code: "payment_ineligible", error: "No matching eligible payment was found." });
    }
    const exp = Math.floor(now() / 1000) + 15 * 60;
    return response(200, {
      token: issueEntitlement({ version: 1, scanId, sessionId, exp }, config.entitlementSigningSecret),
      expiresAt: new Date(exp * 1000).toISOString(),
    });
  }

  async function createWithdrawal(event: APIGatewayProxyEventV2): Promise<JsonResponse> {
    const { name, contractReference, email, statement, turnstileToken, requestId } = withdrawalSchema.parse(parseJson(event));
    if (!config.durableConfirmationEnabled) {
      return response(503, { error: "Withdrawal confirmation is temporarily unavailable." });
    }
    const remoteIp = event.requestContext.http.sourceIp;
    const timestamp = now();
    const existingAttempt = withdrawalAttempts.get(remoteIp);
    if (existingAttempt && existingAttempt.resetAt > timestamp && existingAttempt.count >= 5) {
      return response(429, { error: "Withdrawal requests are temporarily unavailable. Please try again later." });
    }
    withdrawalAttempts.set(remoteIp, {
      count: existingAttempt && existingAttempt.resetAt > timestamp ? existingAttempt.count + 1 : 1,
      resetAt: existingAttempt?.resetAt && existingAttempt.resetAt > timestamp ? existingAttempt.resetAt : timestamp + 15 * 60 * 1_000,
    });
    try {
      const verified = await turnstile.verify({ token: turnstileToken, remoteIp, expectedAction: "withdrawal" });
      if (!verified) return response(403, { error: "Verification could not be completed." });
    } catch {
      return response(503, { error: "Verification is temporarily unavailable." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    let paymentIntent: PaymentIntentSnapshot;
    try {
      paymentIntent = await stripe.payments.retrieve(contractReference);
    } catch {
      return response(202, { message: "Your request needs support review. Email hello@solve-lang.com with your Stripe receipt reference." });
    }
    if (paymentIntent.metadata?.product !== PRODUCT || paymentIntent.receiptEmail?.trim().toLowerCase() !== normalizedEmail) {
      return response(202, { message: "Your request needs support review. Email hello@solve-lang.com with your Stripe receipt reference." });
    }
    const receivedAt = new Date(now()).toISOString();
    try {
      await durableConfirmation.queueWithdrawalConfirmation({
        email,
        name,
        contractReference,
        statement,
        receivedAt,
        supportEmail: "hello@solve-lang.com",
        idempotencyKey: `withdrawal-${createHash("sha256").update(`${contractReference}:${requestId}`).digest("hex")}`,
      });
    } catch {
      return response(503, { error: "Withdrawal confirmation is temporarily unavailable." });
    }
    return response(202, { receivedAt, message: "Your withdrawal request was received. Eligibility will be reviewed under applicable law." });
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
      if (method === "POST" && path.endsWith("/withdraw")) return await createWithdrawal(event);
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
