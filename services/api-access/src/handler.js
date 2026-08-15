import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { KMSClient } from "@aws-sdk/client-kms";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import Stripe from "stripe";
import { createAccountAccessAdminHandler } from "./account-access-admin-handler.js";
import { createAccessGuardedApiAccessService } from "./account-access-api-service.js";
import { createDynamoAccountAccessReader } from "./account-access-reader.js";
import { createAccountAccessService } from "./account-access.js";
import { createDynamoAccountAccessStore } from "./account-access-store.js";
import { createAccountIdentityResolver } from "./account-identity-resolver.js";
import { createAdminCustomerHandler } from "./admin-customer-handler.js";
import { createAdminCustomerService } from "./admin-customer-service.js";
import { createDynamoAdminCrmStore } from "./admin-crm-store.js";
import { createApiAccessHandler } from "./api-handler.js";
import { parseApiAccessEnvironment } from "./config.js";
import { createCustomerAccountService } from "./customer-account.js";
import { createAccessGuardedCustomerAuthService } from "./customer-auth-access-service.js";
import { createAccessGuardedCustomerAuthStore } from "./customer-auth-access-guard.js";
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
import { createTotpSecretProtector } from "./totp-kms.js";

const environment = parseApiAccessEnvironment(process.env);
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const store = createDynamoApiAccessStore(documentClient, environment);
const usageReader = createDynamoCustomerUsageReader(documentClient, environment.usageTable);
const service = createApiAccessService({
  store,
  pepper: environment.pepper,
  mode: environment.mode,
});

let accountAccess;
let accountIdentityResolver;
let customerAuth;
let customerAuthStore;
if (environment.customerAccountsEnabled) {
  const accountAccessStore = createDynamoAccountAccessStore(documentClient, {
    tableName: environment.customerAuthTable,
  });
  const accountAccessReader = createDynamoAccountAccessReader(documentClient, {
    tableName: environment.customerAuthTable,
  });
  accountAccess = createAccountAccessService({ store: accountAccessStore });
  const totpProtector = environment.customerTotpEnabled
    ? createTotpSecretProtector(new KMSClient({}), environment.customerTotpKmsKeyArn)
    : undefined;
  customerAuthStore = createDynamoCustomerAuthStore(documentClient, environment.customerAuthTable);
  accountIdentityResolver = createAccountIdentityResolver({
    store: customerAuthStore,
    pepper: environment.customerAuthPepper,
  });
  const guardedAuthStore = createAccessGuardedCustomerAuthStore(
    customerAuthStore,
    accountAccessReader,
  );
  customerAuth = createAccessGuardedCustomerAuthService(createCustomerAuthService({
    store: guardedAuthStore,
    emailGateway: createCustomerEmailGateway(new SESv2Client({}), {
      sender: environment.customerAuthEmailSender,
      replyTo: environment.customerAuthEmailReplyTo,
    }),
    pepper: environment.customerAuthPepper,
    siteOrigin: environment.siteOrigin,
    totpFeatureEnabled: environment.customerTotpEnabled,
    totpProtector,
  }));
}

const guardedService = accountAccess
  ? createAccessGuardedApiAccessService(service, accountAccess)
  : service;
const customerAccount = createCustomerAccountService({
  store,
  apiAccessService: guardedService,
  usageReader,
});
const accountAccessAdminApplication = accountAccess
  ? createAccountAccessAdminHandler({
      accountAccess,
      identityResolver: accountIdentityResolver,
      adminSecret: environment.adminSecret,
      siteOrigin: environment.siteOrigin,
    })
  : undefined;
const adminCustomerApplication = environment.adminCrmEnabled && accountAccess && accountIdentityResolver && customerAuthStore
  ? createAdminCustomerHandler({
      customers: createAdminCustomerService({
        identityResolver: accountIdentityResolver,
        accountAccess,
        apiStore: store,
        authStore: customerAuthStore,
        usageReader,
        crmStore: createDynamoAdminCrmStore(documentClient, {
          tableName: environment.adminCrmTable,
          profileIndex: environment.adminCrmProfileIndex,
        }),
      }),
      adminSecret: environment.adminSecret,
      siteOrigin: environment.siteOrigin,
    })
  : undefined;

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
    apiAccessService: guardedService,
    priceIds: environment.priceIds,
    siteOrigin: environment.siteOrigin,
    enabled: true,
  });
  subscriptionPortal = createSubscriptionPortalService({
    apiAccessService: guardedService,
    siteOrigin: environment.siteOrigin,
    enabled: true,
  });
  subscriptionLifecycle = createSubscriptionLifecycleService({
    apiAccessService: service,
    eventStore: createDynamoSubscriptionEventStore(documentClient, environment.subscriptionEventsTable),
    gateway: stripeGateway,
    priceIds: environment.priceIds,
  });
  subscriptionManagementApplication = createSubscriptionManagementHandler({
    customerAuth,
    management: createSubscriptionManagementService({
      gateway: stripeGateway,
      apiAccessService: guardedService,
      priceIds: environment.priceIds,
      enabled: true,
    }),
    siteOrigin: environment.siteOrigin,
    enabled: true,
  });
}

const application = createApiAccessHandler({
  service: guardedService,
  enabled: environment.enabled,
  adminSecret: environment.adminSecret,
  siteOrigin: environment.siteOrigin,
  customerAccountsEnabled: environment.customerAccountsEnabled,
  customerTotpEnabled: environment.customerTotpEnabled,
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
  if (path.endsWith("/internal/accounts/access") && accountAccessAdminApplication) {
    return accountAccessAdminApplication(event);
  }
  if (path.includes("/internal/admin/customers") && adminCustomerApplication) {
    return adminCustomerApplication(event);
  }
  if (path.endsWith("/customer/subscriptions/portal") && event?.body && subscriptionManagementApplication) {
    return subscriptionManagementApplication(event);
  }
  return application(event);
}
