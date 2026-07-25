import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import Stripe from "stripe";
import { parseEntitlementEnvironment } from "./config.js";
import { createEntitlementService } from "./service.js";
import { createStripeGateway } from "./stripe.js";
import { createEntitlementStore } from "./store.js";

const environment = parseEntitlementEnvironment(process.env);

const stripeClient = new Stripe(environment.STRIPE_SECRET_KEY, {
  apiVersion: "2026-06-24.dahlia",
});
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const stripe = createStripeGateway(stripeClient);
const store = createEntitlementStore(documentClient, environment.ENTITLEMENTS_TABLE);

const service = createEntitlementService({
  config: {
    siteOrigin: environment.SITE_ORIGIN,
    stripeWebhookSecret: environment.STRIPE_WEBHOOK_SECRET,
    entitlementSigningSecret: environment.ENTITLEMENT_SIGNING_SECRET,
    mode: environment.ENTITLEMENT_MODE,
    checkoutEnabled: environment.CHECKOUT_ENABLED === "true",
  },
  stripe,
  store,
});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  return service(event);
}
