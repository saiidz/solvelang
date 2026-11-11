import { parseStudioAcceptanceOrigin } from "./studio-acceptance-origin.js";

function required(environment, name, minimum = 1) {
  const value = environment[name];
  if (typeof value !== "string" || value.length < minimum) throw new Error(`${name} is required.`);
  return value;
}

// Optional previous pepper for dual-read rotation (see
// docs/production-operations.md). Unset or blank means "no rotation window
// open" and behavior is exactly the pre-rotation behavior. A non-blank value
// shorter than the pepper minimum is a configuration error, not a window.
function optionalPepper(environment, name) {
  const value = environment[name];
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.length < 32) throw new Error(`${name} must contain at least 32 characters when set.`);
  return value;
}

function shared(environment) {
  const mode = environment.API_ACCESS_MODE ?? "test";
  if (mode !== "test" && mode !== "live") throw new Error("API_ACCESS_MODE must be test or live.");
  return {
    enabled: environment.API_ACCESS_ENABLED === "true",
    mode,
    pepper: required(environment, "API_KEY_PEPPER", 32),
    previousPepper: optionalPepper(environment, "API_KEY_PEPPER_PREVIOUS"),
    accountsTable: required(environment, "API_ACCOUNTS_TABLE"),
    keysTable: required(environment, "API_KEYS_TABLE"),
    keysAccountIndex: environment.API_KEYS_ACCOUNT_INDEX ?? "AccountIdIndex",
  };
}

function usage(environment) {
  return { usageTable: required(environment, "API_USAGE_TABLE"), idempotencyTable: required(environment, "API_USAGE_IDEMPOTENCY_TABLE") };
}

function billing(environment) {
  const enabled = environment.API_SUBSCRIPTION_BILLING_ENABLED === "true";
  return {
    subscriptionBillingEnabled: enabled,
    subscriptionEventsTable: required(environment, "API_SUBSCRIPTION_EVENTS_TABLE"),
    stripeSecretKey: enabled ? required(environment, "STRIPE_SECRET_KEY") : undefined,
    stripeWebhookSecret: enabled ? required(environment, "STRIPE_SUBSCRIPTION_WEBHOOK_SECRET") : undefined,
    priceIds: {
      developer: enabled ? required(environment, "STRIPE_API_DEVELOPER_PRICE_ID") : undefined,
      pro: enabled ? required(environment, "STRIPE_API_PRO_PRICE_ID") : undefined,
      business: enabled ? required(environment, "STRIPE_API_BUSINESS_PRICE_ID") : undefined,
    },
    // Merge Governance pricing stays optional at parse time: an absent or
    // partial set leaves only the Merge Governance checkout dark (its
    // service fails closed per plan), never the API-plan billing above.
    mergeGovernancePriceIds: {
      "mgov-regular-monthly": environment.STRIPE_MGOV_REGULAR_MONTHLY_PRICE_ID || undefined,
      "mgov-regular-annual": environment.STRIPE_MGOV_REGULAR_ANNUAL_PRICE_ID || undefined,
      "mgov-plus-monthly": environment.STRIPE_MGOV_PLUS_MONTHLY_PRICE_ID || undefined,
      "mgov-plus-annual": environment.STRIPE_MGOV_PLUS_ANNUAL_PRICE_ID || undefined,
    },
  };
}

function mergeGovernanceService(environment) {
  // The merge-governance pilot service (private repo) backs the
  // signed-in "connect a repository" proxy routes. Optional like the
  // Merge Governance prices: BOTH values present or the proxy stays
  // dark (its routes answer 503) — a partial pair never enables a
  // half-wired proxy.
  const rawBase = typeof environment.MGOV_PILOT_BASE_URL === "string" ? environment.MGOV_PILOT_BASE_URL.trim().replace(/\/+$/, "") : "";
  const baseUrl = rawBase || undefined;
  const adminToken = environment.MGOV_ADMIN_TOKEN || undefined;
  return { mergeGovernanceService: { baseUrl, adminToken, enabled: Boolean(baseUrl && adminToken) } };
}

function customerAccess(environment) {
  const enabled = environment.API_CUSTOMER_ACCOUNTS_ENABLED === "true";
  return { customerAccountsEnabled: enabled, customerAuthTable: enabled ? required(environment, "API_CUSTOMER_AUTH_TABLE") : undefined };
}

function customerAccounts(environment) {
  const access = customerAccess(environment);
  const totpEnabled = environment.API_CUSTOMER_TOTP_ENABLED === "true";
  if (totpEnabled && !access.customerAccountsEnabled) throw new Error("Authenticator 2FA requires customer accounts to be enabled.");
  const customerTotpKmsKeyArn = totpEnabled ? required(environment, "API_CUSTOMER_TOTP_KMS_KEY_ARN") : undefined;
  if (customerTotpKmsKeyArn && !/^arn:[^:]+:kms:[^:]+:\d{12}:key\/.+/.test(customerTotpKmsKeyArn)) throw new Error("API_CUSTOMER_TOTP_KMS_KEY_ARN must contain a full KMS key ARN.");
  return {
    ...access,
    customerAuthPepper: access.customerAccountsEnabled ? required(environment, "API_CUSTOMER_AUTH_PEPPER", 32) : undefined,
    customerAuthPreviousPepper: access.customerAccountsEnabled ? optionalPepper(environment, "API_CUSTOMER_AUTH_PEPPER_PREVIOUS") : undefined,
    customerAuthEmailSender: access.customerAccountsEnabled ? required(environment, "API_CUSTOMER_AUTH_EMAIL_SENDER") : undefined,
    customerAuthEmailReplyTo: environment.API_CUSTOMER_AUTH_EMAIL_REPLY_TO || undefined,
    customerTotpEnabled: totpEnabled,
    customerTotpKmsKeyArn,
  };
}

function adminCrm(environment) {
  const enabled = environment.API_ADMIN_CRM_ENABLED === "true";
  return { adminCrmEnabled: enabled, adminCrmTable: enabled ? required(environment, "API_ADMIN_CRM_TABLE") : undefined, adminCrmProfileIndex: environment.API_ADMIN_CRM_PROFILE_INDEX ?? "RecordTypeUpdatedAtIndex" };
}

function supportAutomation(environment) {
  const enabled = environment.API_SUPPORT_AUTOMATION_ENABLED === "true";
  const activationEnabled = environment.API_SUPPORT_AUTOMATION_ACTIVATION_ENABLED === "true";
  if (activationEnabled && !enabled) throw new Error("Support automation activation requires support automation to be enabled.");
  return {
    supportAutomationEnabled: enabled,
    supportAutomationActivationEnabled: activationEnabled,
    supportAutomationTable: enabled ? required(environment, "API_SUPPORT_AUTOMATION_TABLE") : undefined,
  };
}

function liveCenter(environment) {
  // Live Center stays dark until every pilot pointer is present: a partial
  // configuration never enables a half-wired board proxy, it simply leaves
  // the route failing closed (503 mgov_not_configured) — the same
  // optional-config discipline as the Merge Governance price IDs above.
  const config = {
    baseUrl: environment.MGOV_PILOT_BASE_URL || undefined,
    adminToken: environment.MGOV_ADMIN_TOKEN || undefined,
    tenant: environment.MGOV_PILOT_TENANT || undefined,
    owner: environment.MGOV_PILOT_OWNER || undefined,
    repo: environment.MGOV_PILOT_REPO || undefined,
    installationId: environment.MGOV_PILOT_INSTALLATION_ID || undefined,
  };
  const enabled = Object.values(config).every((value) => typeof value === "string" && value.length > 0);
  // The Minutes seam: the runners-ledger pointers join the parsed
  // config ONLY when both are present, so the parsed shape is
  // unchanged until the day the runners service is actually wired —
  // and a half-set pair never enables a half-wired minutes read.
  const minutesBaseUrl = environment.RUNNERS_LEDGER_BASE_URL || undefined;
  const minutesAdminToken = environment.RUNNERS_LEDGER_ADMIN_TOKEN || undefined;
  const minutes =
    minutesBaseUrl && minutesAdminToken
      ? { minutesEnabled: true, minutesBaseUrl, minutesAdminToken }
      : {};
  return { liveCenter: { enabled, ...config, ...minutes } };
}

function githubApp(environment) {
  // The GitHub App is dark until every credential is present: a partial
  // configuration never enables a half-wired sign-in or webhook surface,
  // it simply leaves the whole feature off (fail closed).
  const config = {
    appId: environment.API_GITHUB_APP_ID || undefined,
    clientId: environment.API_GITHUB_APP_CLIENT_ID || undefined,
    clientSecret: environment.API_GITHUB_APP_CLIENT_SECRET || undefined,
    privateKey: environment.API_GITHUB_APP_PRIVATE_KEY || undefined,
    webhookSecret: environment.API_GITHUB_APP_WEBHOOK_SECRET || undefined,
  };
  const enabled = Object.values(config).every((value) => typeof value === "string" && value.length > 0);
  // The app slug only builds the public install URL; it is not a
  // credential, so it never gates `enabled` and defaults to the
  // production app's slug.
  const slug = environment.API_GITHUB_APP_SLUG || "solvelang-reader";
  return { githubApp: { enabled, ...config, slug } };
}

export function parseApiAccessEnvironment(environment = process.env) {
  const customer = customerAccounts(environment);
  const automation = supportAutomation(environment);
  if (automation.supportAutomationEnabled && !customer.customerAccountsEnabled) throw new Error("Support automation requires customer accounts to be enabled.");
  const siteOrigin = required(environment, "SITE_ORIGIN");
  return {
    ...shared(environment), ...usage(environment), ...billing(environment), ...customer, ...adminCrm(environment), ...automation, ...githubApp(environment), ...mergeGovernanceService(environment), ...liveCenter(environment),
    adminSecret: required(environment, "API_ACCESS_ADMIN_SECRET", 32), siteOrigin,
    studioAcceptanceOrigin: parseStudioAcceptanceOrigin(environment.STUDIO_ACCEPTANCE_ORIGIN, siteOrigin),
    turnstileSecretKey: environment.API_TURNSTILE_SECRET_KEY || undefined,
  };
}

export function parseApiKeyAuthorizerEnvironment(environment = process.env) {
  return { ...shared(environment), ...usage(environment), ...customerAccess(environment) };
}
