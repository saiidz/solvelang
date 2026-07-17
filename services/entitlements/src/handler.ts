import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import Stripe from "stripe";
import { z } from "zod";
import { issueEntitlement } from "./token.js";

const env = z.object({
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_ID: z.string().min(1),
  ENTITLEMENT_SIGNING_SECRET: z.string().min(32),
  ENTITLEMENTS_TABLE: z.string().min(1),
  SITE_ORIGIN: z.string().url(),
}).parse(process.env);

const stripe = new Stripe(env.STRIPE_SECRET_KEY);
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const checkoutSchema = z.object({ scanId: z.string().uuid() });
const entitlementSchema = z.object({ scanId: z.string().uuid(), sessionId: z.string().startsWith("cs_") });

function response(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": env.SITE_ORIGIN,
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization,stripe-signature",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function parseJson(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  return JSON.parse(raw);
}

async function createCheckout(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const { scanId } = checkoutSchema.parse(parseJson(event));
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${env.SITE_ORIGIN}/check/?scan_id=${encodeURIComponent(scanId)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.SITE_ORIGIN}/check/?scan_id=${encodeURIComponent(scanId)}&checkout=cancelled`,
    metadata: { scanId, product: "workflow-preflight-v1" },
    allow_promotion_codes: true,
    billing_address_collection: "auto",
  }, { idempotencyKey: `preflight-${scanId}` });
  if (!session.url) return response(502, { error: "Stripe did not return a checkout URL." });
  return response(200, { checkoutUrl: session.url });
}

async function handleWebhook(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const signature = event.headers["stripe-signature"];
  if (!signature || !event.body) return response(400, { error: "Missing Stripe signature or body." });
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, "base64") : Buffer.from(event.body, "utf8");
  const stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);

  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    const scanId = session.metadata?.scanId;
    if (scanId && session.payment_status === "paid") {
      await db.send(new PutCommand({
        TableName: env.ENTITLEMENTS_TABLE,
        Item: {
          scanId,
          sessionId: session.id,
          paymentStatus: session.payment_status,
          stripeEventId: stripeEvent.id,
          createdAt: new Date().toISOString(),
          expiresAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
        },
        ConditionExpression: "attribute_not_exists(scanId) OR sessionId = :sessionId",
        ExpressionAttributeValues: { ":sessionId": session.id },
      }));
    }
  }
  return response(200, { received: true });
}

async function createEntitlement(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const { scanId, sessionId } = entitlementSchema.parse(parseJson(event));
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== "paid" || session.metadata?.scanId !== scanId) {
    return response(403, { error: "No matching paid checkout was found." });
  }
  const exp = Math.floor(Date.now() / 1000) + 15 * 60;
  const token = issueEntitlement({ version: 1, scanId, sessionId, exp }, env.ENTITLEMENT_SIGNING_SECRET);
  return response(200, { token, expiresAt: new Date(exp * 1000).toISOString() });
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    if (event.requestContext.http.method === "OPTIONS") return response(204, {});
    const path = event.rawPath.replace(/\/$/, "");
    if (event.requestContext.http.method === "POST" && path.endsWith("/checkout")) return await createCheckout(event);
    if (event.requestContext.http.method === "POST" && path.endsWith("/webhook")) return await handleWebhook(event);
    if (event.requestContext.http.method === "POST" && path.endsWith("/entitlement")) return await createEntitlement(event);
    return response(404, { error: "Not found." });
  } catch (error) {
    console.error("entitlement_api_error", error instanceof Error ? error.message : error);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return response(400, { error: "Invalid request." });
    return response(500, { error: "Request failed." });
  }
}
