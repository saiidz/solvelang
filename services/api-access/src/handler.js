import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import Stripe from "stripe";
import { createApiAccessHandler } from "./api-handler.js";
import { parseApiAccessEnvironment } from "./config.js";
import { createDynamoApiAccessStore } from "./dynamo-store.js";
import { createApiAccessService } from "./service.js";
import { createStripeSubscriptionGateway } from "./stripe-subscriptions.js";
import { createDynamoSubscriptionEventStore } from "./subscription-event-store.js";
import { createSubscriptionCheckoutService, createSubscriptionLifecycleService } from "./subscriptions.js";

const environment = parseApiAccessEnvironment(process.env);
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const store = createDynamoApiAccessStore(documentClient, environment);
const service = createApiAccessService({
  store,
  pepper: environment.pepper,
  mode: environment.mode,
});

let stripeGateway;
let subscriptionCheckout;
let subscriptionLifecycle;
if (environment.subscriptionBillingEnabled) {
  const stripe = new Stripe(environment.stripeSecretKey, { apiVersion: "2026-06-24.dahlia" });
  stripeGateway = createStripeSubscriptionGateway(stripe, environment.stripeWebhookSecret);
  subscriptionCheckout = createSubscriptionCheckoutService({
    gateway: stripeGateway,
    apiAccessService: service,
    priceIds: environment.priceIds,
    siteOrigin: environment.siteOrigin,
    enabled: true,
  });
  subscriptionLifecycle = createSubscriptionLifecycleService({
    apiAccessService: service,
    eventStore: createDynamoSubscriptionEventStore(documentClient, environment.subscriptionEventsTable),
    priceIds: environment.priceIds,
  });
}

const application = createApiAccessHandler({
  service,
  enabled: environment.enabled,
  adminSecret: environment.adminSecret,
  siteOrigin: environment.siteOrigin,
  subscriptionBillingEnabled: environment.subscriptionBillingEnabled,
  subscriptionCheckout,
  subscriptionLifecycle,
  stripeGateway,
});

export async function handler(event) {
  return application(event);
}
