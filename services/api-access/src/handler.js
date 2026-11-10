import { createHmac, randomBytes as nodeRandomBytes } from "node:crypto";
import { createStudioWorkspaceStore, createStudioWorkspaceHandler } from "./studio-workspace.js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { KMSClient } from "@aws-sdk/client-kms";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
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
import { createDynamoPublicStatusStore } from "./public-status-store.js";
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
import { createElementsSubscriptionCheckoutService } from "./elements-subscription-checkout.js";
import { createMergeGovernanceCheckoutService } from "./merge-governance-checkout.js";
import { createMergeGovernanceConnectService } from "./merge-governance-connect.js";
import { createLiveCenterService } from "./live-center.js";
import { applyInstallationWebhook, buildAuthorizeUrl, buildInstallUrl, exchangeOAuthCode, fetchGitHubUser, linkInstallationFromGitHub, verifyWebhookSignature } from "./github-app.js";
import { createDynamoGitHubStore } from "./github-store.js";
import { runRepositoryAuditRead } from "./github-repo-reader.js";
import { createApiAccessService } from "./service.js";
import { createStripeSubscriptionGateway } from "./stripe-subscriptions.js";
import { createSubscriptionManagementHandler } from "./subscription-management-handler.js";
import { createSubscriptionManagementService } from "./subscription-management.js";
import { createSubscriptionPortalService } from "./subscription-portal.js";
import { createDynamoSubscriptionEventStore } from "./subscription-event-store.js";
import { createSubscriptionLifecycleService } from "./subscriptions.js";
import { createSupportAutomationApiHandler } from "./support-automation-api-handler.js";
import { createGmailSupportProvider, createLinearSupportProvider, createSecretsManagerCredentialResolver } from "./support-automation-providers.js";
import { createDynamoSupportAutomationStore } from "./support-automation-store.js";
import { createSupportAutomationService } from "./support-automation.js";
import { createTotpSecretProtector } from "./totp-kms.js";
import { createTurnstileVerifier } from "./turnstile.js";

// GitHub App sign-in + installations service. It composes the github-app
// primitives with the customer auth store, and its session issuance
// deliberately mirrors customer-auth.js — same cookie name/attributes,
// same sess_ token shape, same pepper fingerprint digest, same store
// record — so a session minted here is indistinguishable from a
// magic-link session to authenticate(). If the auth internals change,
// this must change with them.
const GITHUB_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const GITHUB_SESSION_COOKIE = "sl_api_session";

function githubDigest(pepper, purpose, value) {
  return createHmac("sha256", pepper).update(`${purpose}:${value}`).digest("hex");
}

function githubAuthVersionOf(value) {
  if (value === undefined) return 1;
  return Number.isSafeInteger(value) && value >= 1 ? value : undefined;
}

// Mirrors accountTotpState in customer-auth.js.
function githubTotpState(account) {
  const enabledAt = account?.totpEnabledAt;
  const secretCiphertext = account?.totpSecretCiphertext;
  if (enabledAt === undefined && secretCiphertext === undefined) return "disabled";
  if (typeof enabledAt === "string" && enabledAt.length > 0 && typeof secretCiphertext === "string" && secretCiphertext.length > 0) return "enabled";
  return "invalid";
}

function createGitHubAppService({ config, store, authStore, identityResolver, pepper }) {
  return {
    async beginAuthorize() {
      const nonce = Buffer.from(nodeRandomBytes(24)).toString("hex");
      await store.putOAuthState({ nonce });
      return { location: buildAuthorizeUrl({ clientId: config.clientId, state: nonce }) };
    },

    async beginInstall(accountId) {
      if (typeof accountId !== "string" || !accountId) throw new Error("SolveLang account id is required.");
      const nonce = Buffer.from(nodeRandomBytes(24)).toString("hex");
      await store.putOAuthState({ nonce, purpose: "install", accountId });
      return { location: buildInstallUrl({ slug: config.slug, state: nonce }) };
    },

    async linkInstallation({ accountId, installationId, state }) {
      return linkInstallationFromGitHub({ store, appId: config.appId, privateKey: config.privateKey, accountId, installationId, state });
    },

    async runAudit({ accountId, installationId, repoFullName }) {
      return runRepositoryAuditRead({ store, appId: config.appId, privateKey: config.privateKey, accountId, installationId, repoFullName });
    },

    async completeSignIn({ code, state }) {
      if (typeof code !== "string" || !code || typeof state !== "string" || !state) throw new Error("GitHub sign-in callback is incomplete.");
      if (!(await store.consumeOAuthState(state))) throw new Error("GitHub sign-in state is invalid or expired.");
      const { accessToken } = await exchangeOAuthCode({ clientId: config.clientId, clientSecret: config.clientSecret, code });
      const user = await fetchGitHubUser({ token: accessToken });
      // Account resolution binds ONLY to a GitHub-verified email — the
      // same mailbox-control proof the magic-link flow establishes.
      if (!user.primaryVerifiedEmail) throw new Error("GitHub account has no verified email.");
      const email = user.primaryVerifiedEmail;
      const { accountId } = await identityResolver.resolve({ email });
      const timestamp = Date.now();
      let account = await authStore.getAccount(accountId);
      const authVersion = githubAuthVersionOf(account?.authVersion);
      if (!authVersion) throw new Error("Customer authentication version is invalid.");
      // Fail closed: an account with an authenticator enabled never gets
      // a session from GitHub alone — the authenticator step-up stays
      // mandatory, so those customers keep using password/magic-link +
      // TOTP. (The auth store itself throws on an invalid TOTP state.)
      if (githubTotpState(account) !== "disabled") throw new Error("GitHub sign-in is unavailable for this account.");
      if (!account) {
        account = await authStore.ensureAccount({ accountId, email, createdAt: new Date(timestamp).toISOString() });
      }
      const sessionId = Buffer.from(nodeRandomBytes(12)).toString("hex");
      const secret = Buffer.from(nodeRandomBytes(32)).toString("base64url");
      const token = `sess_${sessionId}_${secret}`;
      const verifiedAt = new Date(timestamp).toISOString();
      await authStore.putSession({
        session: {
          sessionId,
          secretFingerprint: githubDigest(pepper, "session", token),
          authVersion,
          createdAt: verifiedAt,
          expiresAt: Math.floor((timestamp + GITHUB_SESSION_TTL_MS) / 1_000),
          emailVerifiedAt: verifiedAt,
        },
        accountId,
        email,
      });
      return {
        accountId,
        email,
        cookie: `${GITHUB_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Domain=.solve-lang.com; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${Math.floor(GITHUB_SESSION_TTL_MS / 1_000)}`,
      };
    },

    async handleWebhook({ rawBody, signature }) {
      if (!verifyWebhookSignature({ secret: config.webhookSecret, rawBody, signature })) return false;
      let payload;
      try { payload = JSON.parse(rawBody); } catch { return true; }
      await applyInstallationWebhook({ store, payload });
      return true;
    },

    async listForAccount(accountId) {
      const installations = await store.listInstallationsForAccount(accountId);
      return installations.map(({ installationId, accountLogin, accountType, repositories, suspended }) => ({
        installationId, accountLogin, accountType, repositories, suspended,
      }));
    },
  };
}

const environment = parseApiAccessEnvironment(process.env);
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const publicStatusStore = createDynamoPublicStatusStore(documentClient, process.env.PUBLIC_STATUS_TABLE);
const statusProbes = { accountPersistence: undefined, billing: undefined };
const store = createDynamoApiAccessStore(documentClient, environment);
const usageReader = createDynamoCustomerUsageReader(documentClient, environment.usageTable);
const service = createApiAccessService({ store, pepper: environment.pepper, previousPepper: environment.previousPepper, mode: environment.mode });

let accountAccess;
let accountIdentityResolver;
let customerAuth;
let githubApp;
let customerAuthStoreForAdmin;
if (environment.customerAccountsEnabled) {
  const accountAccessStore = createDynamoAccountAccessStore(documentClient, { tableName: environment.customerAuthTable });
  const accountAccessReader = createDynamoAccountAccessReader(documentClient, { tableName: environment.customerAuthTable });
  accountAccess = createAccountAccessService({ store: accountAccessStore });
  const totpProtector = environment.customerTotpEnabled ? createTotpSecretProtector(new KMSClient({}), environment.customerTotpKmsKeyArn) : undefined;
  const customerAuthStore = createDynamoCustomerAuthStore(documentClient, environment.customerAuthTable);
  customerAuthStoreForAdmin = customerAuthStore;
  accountIdentityResolver = createAccountIdentityResolver({ store: customerAuthStore, pepper: environment.customerAuthPepper, previousPepper: environment.customerAuthPreviousPepper });
  const guardedAuthStore = createAccessGuardedCustomerAuthStore(
    customerAuthStore,
    accountAccessReader,
  );
  if (environment.githubApp.enabled) {
    const githubInstallationsTable = process.env.API_GITHUB_INSTALLATIONS_TABLE;
    if (typeof githubInstallationsTable !== "string" || !githubInstallationsTable) throw new Error("API_GITHUB_INSTALLATIONS_TABLE is required when the GitHub App is enabled.");
    githubApp = createGitHubAppService({
      config: environment.githubApp,
      store: createDynamoGitHubStore(documentClient, githubInstallationsTable),
      authStore: customerAuthStore,
      identityResolver: accountIdentityResolver,
      pepper: environment.customerAuthPepper,
    });
  }
  customerAuth = createAccessGuardedCustomerAuthService(createCustomerAuthService({
    store: guardedAuthStore,
    emailGateway: createCustomerEmailGateway(new SESv2Client({}), { sender: environment.customerAuthEmailSender, replyTo: environment.customerAuthEmailReplyTo }),
    pepper: environment.customerAuthPepper,
    previousPepper: environment.customerAuthPreviousPepper,
    siteOrigin: environment.siteOrigin,
    studioAcceptanceOrigin: environment.studioAcceptanceOrigin,
    totpFeatureEnabled: environment.customerTotpEnabled,
    totpProtector,
  }));
}

const guardedService = accountAccess ? createAccessGuardedApiAccessService(service, accountAccess) : service;
const customerAccount = createCustomerAccountService({ store, apiAccessService: guardedService, usageReader });
const accountAccessAdminApplication = accountAccess ? createAccountAccessAdminHandler({ accountAccess, identityResolver: accountIdentityResolver, adminSecret: environment.adminSecret, siteOrigin: environment.siteOrigin }) : undefined;
const adminCustomerApplication = environment.adminCrmEnabled && accountAccess && accountIdentityResolver && customerAuthStoreForAdmin
  ? createAdminCustomerHandler({
      customers: createAdminCustomerService({
        identityResolver: accountIdentityResolver,
        accountAccess,
        apiStore: store,
        authStore: customerAuthStoreForAdmin,
        usageReader,
        crmStore: createDynamoAdminCrmStore(documentClient, { tableName: environment.adminCrmTable, profileIndex: environment.adminCrmProfileIndex }),
      }),
      adminSecret: environment.adminSecret,
      siteOrigin: environment.siteOrigin,
    })
  : undefined;

let supportAutomation;
if (environment.supportAutomationEnabled) {
  const credentialResolver = createSecretsManagerCredentialResolver(new SecretsManagerClient({}));
  supportAutomation = createSupportAutomationService({
    store: createDynamoSupportAutomationStore(documentClient, environment.supportAutomationTable),
    gmail: createGmailSupportProvider({ credentialResolver }),
    linear: createLinearSupportProvider({ credentialResolver }),
    activationEnabled: environment.supportAutomationActivationEnabled,
  });
}
const supportAutomationApplication = createSupportAutomationApiHandler({
  enabled: environment.supportAutomationEnabled,
  supportAutomation,
  customerAuth,
  siteOrigin: environment.siteOrigin,
});

let stripeGateway;
let subscriptionCheckout;
let elementsCheckout;
let mergeGovernanceCheckout;
let subscriptionPortal;
let subscriptionLifecycle;
let subscriptionManagementApplication;
if (environment.subscriptionBillingEnabled) {
  const stripe = new Stripe(environment.stripeSecretKey, { apiVersion: "2026-06-24.dahlia" });
  stripeGateway = createStripeSubscriptionGateway(stripe, environment.stripeWebhookSecret);
  subscriptionCheckout = createEmbeddedSubscriptionCheckoutService({ gateway: stripeGateway, apiAccessService: guardedService, priceIds: environment.priceIds, siteOrigin: environment.siteOrigin, enabled: true });
  elementsCheckout = createElementsSubscriptionCheckoutService({ gateway: stripeGateway, apiAccessService: guardedService, priceIds: environment.priceIds, enabled: true });
  mergeGovernanceCheckout = createMergeGovernanceCheckoutService({ gateway: stripeGateway, apiAccessService: guardedService, priceIds: environment.mergeGovernancePriceIds, enabled: true });
  subscriptionPortal = createSubscriptionPortalService({ apiAccessService: guardedService, siteOrigin: environment.siteOrigin, enabled: true });
  subscriptionLifecycle = createSubscriptionLifecycleService({ apiAccessService: service, eventStore: createDynamoSubscriptionEventStore(documentClient, environment.subscriptionEventsTable), gateway: stripeGateway, priceIds: environment.priceIds });
  statusProbes.billing = async () => { await stripe.balance.retrieve(); return true; };
  subscriptionManagementApplication = createSubscriptionManagementHandler({
    customerAuth,
    management: createSubscriptionManagementService({ gateway: stripeGateway, apiAccessService: guardedService, priceIds: environment.priceIds, enabled: true }),
    siteOrigin: environment.siteOrigin,
    enabled: true,
  });
}

// The repository-connect proxy exists only when the merge-governance
// pilot service is fully configured (base URL + admin token); see
// config.js. Unset pair -> undefined -> the connect routes answer 503.
const mergeGovernanceConnect = environment.mergeGovernanceService.enabled
  ? createMergeGovernanceConnectService({
      baseUrl: environment.mergeGovernanceService.baseUrl,
      adminToken: environment.mergeGovernanceService.adminToken,
    })
  : undefined;

const botProtection = environment.turnstileSecretKey
  ? createTurnstileVerifier({ secret: environment.turnstileSecretKey, expectedHostname: new URL(environment.siteOrigin).hostname })
  : undefined;

if (environment.customerAccountsEnabled && environment.customerAuthTable) {
  statusProbes.accountPersistence = async () => {
    await documentClient.send(new GetCommand({ TableName: environment.customerAuthTable, Key: { authKey: "status#probe" } }));
    return true;
  };
}

const application = createApiAccessHandler({
  service: guardedService,
  enabled: environment.enabled,
  adminSecret: environment.adminSecret,
  siteOrigin: environment.siteOrigin,
  studioAcceptanceOrigin: environment.studioAcceptanceOrigin,
  customerAccountsEnabled: environment.customerAccountsEnabled,
  customerTotpEnabled: environment.customerTotpEnabled,
  customerAuth,
  customerAccount,
  subscriptionBillingEnabled: environment.subscriptionBillingEnabled,
  subscriptionCheckout,
  elementsCheckout,
  mergeGovernanceCheckout,
  mergeGovernanceConnect,
  liveCenter: createLiveCenterService({ config: environment.liveCenter }),
  subscriptionPortal,
  subscriptionLifecycle,
  stripeGateway,
  botProtection,
  githubApp,
  publicStatusReader: () => publicStatusStore.readSnapshot(),
  statusProbes,
});

const studioWorkspaceApplication = createStudioWorkspaceHandler({
  enabled: environment.enabled && environment.customerAccountsEnabled, customerAuth, siteOrigin: environment.siteOrigin,
  studioAcceptanceOrigin: environment.studioAcceptanceOrigin,
  store: environment.customerAccountsEnabled ? createStudioWorkspaceStore(documentClient, environment.customerAuthTable) : undefined,
});

export async function handler(event) {
  const path = (event?.rawPath ?? "/").replace(/\/$/, "") || "/";
  if (path === "/customer/studio/workspace") return studioWorkspaceApplication(event);
  if (path.includes("/customer/support-automation")) return supportAutomationApplication(event);
  if (path.endsWith("/internal/accounts/access") && accountAccessAdminApplication) return accountAccessAdminApplication(event);
  if (path.includes("/internal/admin/customers") && adminCustomerApplication) return adminCustomerApplication(event);
  if (path.endsWith("/customer/subscriptions/portal") && event?.body && subscriptionManagementApplication) return subscriptionManagementApplication(event);
  return application(event);
}

export async function supportAutomationWorker() {
  if (!supportAutomation) return { activationEnabled: false, accounts: [] };
  return supportAutomation.processTick(10);
}
