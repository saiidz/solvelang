import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import Stripe from "stripe";
import { createApiAccessHandler } from "./api-handler.js";
import { parseApiAccessEnvironment } from "./config.js";
import { createCustomerAccountService } from "./customer-account.js";
import { createCustomerAuthService } from "./customer-auth.js";
import { createDynamoCustomerAuthStore } from "./customer-auth-store.js";
import { createCustomerEmailGateway } from "./customer-email.js";
import { createDynamoCustomerUsageReader } from "./customer-usage.js";
import { createDynamoApiAccessStore } from "./dynamo-store.js";
import { createEmbeddedSubscriptionCheckoutService } from "./embedded-subscription-checkout.js";
import { createApiAccessService } from "./service.js";
import { createStripeSubscriptionGateway } from "./stripe-subscriptions.js";
import { createSubscriptionManagementHandler } from "./subscription-management-handler.js";
import { createSubscriptionManagementService } from "./subscription-management.js";
import { createSubscriptionPortalService } from "./subscription-portal.js";
import { createDynamoSubscriptionEventStore } from "./subscription-event-store.js";
import { createSubscriptionLifecycleService } from "./subscriptions.js";

const environment = parseApiAccessEnvironment(process.env);
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const store = createDynamoApiAccessStore(documentClient, environment);
const service = createApiAccessService({
  store,
  pepper: environment.pepper,
  mode: environment.mode,
});
const customerAccount = createCustomerAccountService({
  store,
  apiAccessService: service,
  usageReader: createDynamoCustomerUsageReader(documentClient, environment.usageTable),
});

let customerAuth;
if (environment.customerAccountsEnabled) {
  customerAuth = createCustomerAuthService({
    store: createDynamoCustomerAuthStore(documentClient, environment.customerAuthTable),
    emailGateway: createCustomerEmailGateway(new SESv2Client({}), {
      sender: environment.customerAuthEmailSender,
      replyTo: environment.customerAuthEmailReplyTo,
    }),
    pepper: environment.customerAuthPepper,
    siteOrigin: environment.siteOrigin,
  });
}

let stripeGateway;
let subscriptionCheckout;
let subscriptionPortal;
let subscriptionLifecycle;
let subscriptionManagementApplication;
if (environment.subscriptionBillingEnabled) {
  const stripe = new Stripe(environment.stripeSecretKey, { apiVersion: "2026-06-24.dahlia" });
  stripeGateway = createStripeSubscriptionGateway(stripe, environment.stripeWebhookSecret);
  subscriptionCheckout = createEmbeddedSubscriptionCheckoutService({
    gateway: stripeGateway,
    apiAccessService: service,
    priceIds: environment.priceIds,
    siteOrigin: environment.siteOrigin,
    enabled: true,
  });
  subscriptionPortal = createSubscriptionPortalService({
    apiAccessService: service,
    siteOrigin: environment.siteOrigin,
    enabled: true,
  });
  subscriptionLifecycle = createSubscriptionLifecycleService({
    apiAccessService: service,
    eventStore: createDynamoSubscriptionEventStore(documentClient, environment.subscriptionEventsTable),
    priceIds: environment.priceIds,
  });
  subscriptionManagementApplication = createSubscriptionManagementHandler({
    customerAuth,
    management: createSubscriptionManagementService({
      gateway: stripeGateway,
      apiAccessService: service,
      enabled: true,
    }),
    siteOrigin: environment.siteOrigin,
    enabled: true,
  });
}

const application = createApiAccessHandler({
  service,
  enabled: environment.enabled,
  adminSecret: environment.adminSecret,
  siteOrigin: environment.siteOrigin,
  customerAccountsEnabled: environment.customerAccountsEnabled,
  customerAuth,
  customerAccount,
  subscriptionBillingEnabled: environment.subscriptionBillingEnabled,
  subscriptionCheckout,
  subscriptionPortal,
  subscriptionLifecycle,
  stripeGateway,
});

export async function handler(event) {
  const path = (event?.rawPath ?? "/").replace(/\/$/, "") || "/";
  if (path.endsWith("/customer/subscriptions/portal") && event?.body && subscriptionManagementApplication) {
    return subscriptionManagementApplication(event);
  }
  return application(event);
}
